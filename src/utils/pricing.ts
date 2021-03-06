/* eslint-disable prefer-const */
import { Pair, Token, Bundle, ExchangePair, ExchangeToken, Exchange } from '../../generated/schema'
import { BigDecimal, Address, BigInt, log } from '@graphprotocol/graph-ts/index'
import { factoryContract, ADDRESS_ZERO, BIGDECIMAL_ONE, UNTRACKED_PAIRS, fetchTokenName } from '../utils/helpers'
import { FACTORY_ADDRESS, BIGINT_ONE, BIGDECIMAL_ZERO, BIGINT_ZERO } from '../utils/helpers'
import { LoadExchangePairRet, LoadPairRet, safeFindAndLoadExchangePair, safeLoadBundle, safeLoadExchangePair, safeLoadExchangeToken, safeLoadPair, safeLoadToken } from './loads'

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const DAI_ADDRESS  = '0x6b175474e89094c44da98b954eedeac495271d0f'
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const USDC_WETH_PAIR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc' // created 10008355
const DAI_WETH_PAIR = '0xa478c2975ab1ea89e8196811f51a7b7ade33eb11' // created block 10042267
const USDT_WETH_PAIR = '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852' // created block 10093341

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  //TODO: can instead get all stablecoin pairs for all exchanges
  let loadDaiPair = safeLoadPair(DAI_ADDRESS, WETH_ADDRESS) // dai is token0
  let loadUsdcPair = safeLoadPair(USDC_ADDRESS, WETH_ADDRESS) // usdc is token0
  let loadUsdtPair = safeLoadPair(WETH_ADDRESS, USDT_ADDRESS) // usdt is token1

  let daiPair = loadDaiPair.entity
  let usdcPair = loadUsdcPair.entity
  let usdtPair = loadUsdtPair.entity

  // all 3 have been created
  if (loadDaiPair.exists && loadUsdcPair.exists && loadUsdtPair.exists) {
    let totalLiquidityStables = daiPair.reserve1.plus(usdcPair.reserve1).plus(usdtPair.reserve0)
    let daiWeight = daiPair.reserve1.div(totalLiquidityStables)
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityStables)
    let usdtWeight = usdtPair.reserve0.div(totalLiquidityStables)
    return daiPair.token0Price
      .times(daiWeight)
      .plus(usdcPair.token0Price.times(usdcWeight))
      .plus(usdtPair.token1Price.times(usdtWeight))
    // dai and USDC have been created
  } else if (loadDaiPair.exists && loadUsdcPair.exists) {
    let totalLiquidityETH = daiPair.reserve1.plus(usdcPair.reserve1)
    let daiWeight = daiPair.reserve1.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve1.div(totalLiquidityETH)
    return daiPair.token0Price.times(daiWeight).plus(usdcPair.token0Price.times(usdcWeight))
    // USDC is the only pair so far
  } else if (loadUsdcPair.exists) {
    return usdcPair.token0Price
  } else {
    return BIGDECIMAL_ZERO
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
  '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643', // cDAI
  '0x39aa39c021dfbae8fac545936693ac917d5e7563', // cUSDC
  '0x86fadb80d8d2cff3c3680819e4da99c10232ba0f', // EBASE
  '0x57ab1ec28d129707052df4df418d58a2d46d5f51', // sUSD
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
  '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
  '0x514910771af9ca656af840dff83e8264ecf986ca', //LINK
  '0x960b236a07cf122663c4303350609a66a7b288c0', //ANT
  '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', //SNX
  '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', //YFI
  '0xdf5e0e81dff6faf3a7e52ba697820c5e32d806a8', // yCurv
  '0x853d955acef822db058eb8505911ed77f175b99e', // FRAX
  '0xa47c8bf37f92abed4a126bda807a7b7498661acd', // WUST
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' // WBTC
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('400000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('2')

/**
 * Search through graph to find derived Eth per token.
 **/
export function findEthPerToken(token: Token, exToken: ExchangeToken): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return BIGDECIMAL_ONE
  }
  // loop through whitelist and check if paired with any
  let ethPrice = BIGDECIMAL_ZERO

  let totalLiquidity = token.totalLiquidity.plus(exToken.totalLiquidity)
  let percentTokenLiquidity = token.totalLiquidity.div(totalLiquidity)
  let percentExTokenLiquidity = exToken.totalLiquidity.div(totalLiquidity)

  ethPrice = (token.ethPrice.times(percentTokenLiquidity)).plus((exToken.ethPrice.times(percentExTokenLiquidity)))

  return ethPrice
}

export function findUsdPerToken(token: Token, ethUsdPrice: BigDecimal): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ethUsdPrice
  }
  return token.ethPrice.times(ethUsdPrice)
}

export function findEthPerExchangeToken(exToken: ExchangeToken): BigDecimal {
  if (exToken.token == WETH_ADDRESS) {
    return BIGDECIMAL_ONE
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {

    // load Pair entity based on ordering and find the one for this exchange
    let tokenOrder = exToken.token.localeCompare(WHITELIST[i]);

    let loadExPair: LoadExchangePairRet;
    if(tokenOrder < 0){
      loadExPair = safeFindAndLoadExchangePair(exToken.token, WHITELIST[i], exToken.exchange)
    }
    else if(tokenOrder > 0){
      loadExPair = safeFindAndLoadExchangePair(WHITELIST[i], exToken.token, exToken.exchange)
    }
    else {
      // continue because it matches the whitelisted token
      continue
    }

    if(!loadExPair.exists){
      continue
    }

    let exPair = loadExPair.entity;

    log.info("token0: {}\ntoken1: {}\ntokenOrder: {}",[exPair.token0, exPair.token1, tokenOrder.toString()])

    //if ExchangePair exists
    // return price based on ExchangePair and ExchangeToken
    log.info("exPair.token0: {}\nexPair.token1: {}\nexToken.token: {}\nexPair.reserveETH: {}",[exPair.token0, exPair.token1, exToken.token, exPair.reserveETH.toString()])
    if (exPair.token0 == exToken.token && exPair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
      let loadExToken1 = safeLoadExchangeToken(exPair.token1, exPair.exchange)
      if(!loadExToken1.exists){
        //throw some error
      }
      let exToken1 = loadExToken1.entity
      return exPair.token1Price.times(exToken1.ethPrice as BigDecimal) // return token1 per our token * Eth per token 1
    }
    if (exPair.token1 == exToken.token && exPair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
      let loadExToken0 = safeLoadExchangeToken(exPair.token0, exPair.exchange)
      if(!loadExToken0.exists){
        //throw some error
      }
      let exToken0 = loadExToken0.entity
      return exPair.token0Price.times(exToken0.ethPrice as BigDecimal) // return token0 per our token * ETH per token 0
    }
  }
  return BIGDECIMAL_ZERO // nothing was found return 0
}

export function findUsdPerExchangeToken(exToken: ExchangeToken, ethUsdPrice: BigDecimal): BigDecimal {
  if (exToken.token == WETH_ADDRESS) {
    return ethUsdPrice
  }
  else{
    return exToken.ethPrice.times(ethUsdPrice)
  }
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getExchangeTrackedVolumeUSD(
  exTokenAmount0: BigDecimal,
  exToken0: ExchangeToken,
  exTokenAmount1: BigDecimal,
  exToken1: ExchangeToken,
  exPair: ExchangePair
): BigDecimal {
  let loadBundle = safeLoadBundle('ethUsdPrice', exPair.exchange)
  if(!loadBundle.exists){
    //throw some error
  }
  let bundle = loadBundle.entity
  let price0 = exToken0.ethPrice.times(bundle.value)
  let price1 = exToken1.ethPrice.times(bundle.value)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(exPair.id)) {
    return BIGDECIMAL_ZERO
  }

  let reserve0USD = exPair.reserve0.times(price0)
  let reserve1USD = exPair.reserve1.times(price1)
  if (WHITELIST.includes(exToken0.id) && WHITELIST.includes(exToken1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
      return BIGDECIMAL_ZERO
      }
  }
  if (WHITELIST.includes(exToken0.id) && !WHITELIST.includes(exToken1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
      return BIGDECIMAL_ZERO
      }
  }
  if (!WHITELIST.includes(exToken0.id) && WHITELIST.includes(exToken1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
      return BIGDECIMAL_ZERO
      }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(exToken0.id) && WHITELIST.includes(exToken1.id)) {
    return exTokenAmount0
      .times(price0)
      .plus(exTokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(exToken0.id) && !WHITELIST.includes(exToken1.id)) {
    return exTokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(exToken0.id) && WHITELIST.includes(exToken1.id)) {
    return exTokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return BIGDECIMAL_ZERO
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getExchangeTrackedLiquidityUSD(
  exTokenAmount0: BigDecimal,
  exToken0: ExchangeToken,
  exTokenAmount1: BigDecimal,
  exToken1: ExchangeToken
): BigDecimal {
  let loadBundle = safeLoadBundle('ethUsdPrice', exToken0.exchange)
  if(!loadBundle.exists){
    //throw some error
  }
  let ethUsdPrice = loadBundle.entity
  let price0 = exToken0.ethPrice.times(ethUsdPrice.value)
  let price1 = exToken1.ethPrice.times(ethUsdPrice.value)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(exToken0.token) && WHITELIST.includes(exToken1.token)) {
    return exTokenAmount0.times(price0).plus(exTokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(exToken0.token) && !WHITELIST.includes(exToken1.token)) {
    return exTokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(exToken0.token) && WHITELIST.includes(exToken1.token)) {
    return exTokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return BIGDECIMAL_ZERO
}
