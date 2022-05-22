/* eslint-disable prefer-const */
import { BigInt, BigDecimal, store, Address } from '@graphprotocol/graph-ts'
import { findEthPerToken, getEthPriceInUSD, getTrackedLiquidityUSD, getTrackedVolumeUSD } from '../utils/pricing'
import {
  Pair,
  Token,
  Exchange,
  Transaction,
  Bundle,
  ExchangePair,
  Swap as SwapEvent
} from '../../generated/schema'
import { 
  Pair as PairContract, 
  Mint, 
  Burn, 
  Swap, 
  Transfer, 
  Sync 
} from '../../generated/templates/Pair/Pair'
import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  FACTORY_ADDRESS,
  ONE_BI,
  ZERO_BD,
  BI_18,
} from '../utils/helpers'
import { safeLoadBundle, safeLoadExchange, safeLoadExchangePair, safeLoadToken } from '../utils/loads'

// function isCompleteMint(mintId: string): boolean {
//   return MintEvent.load(mintId).sender !== null // sufficient checks
// }

export function handleSync(event: Sync): void {
  //load pair data
  let loadPair = safeLoadExchangePair(event.address.toHex())
  let loadExchange = safeLoadExchange(loadPair.entity.exchange)
  let loadToken0 = safeLoadToken(loadPair.entity.token0)
  let loadToken1 = safeLoadToken(loadPair.entity.token1)

  if(!loadPair.exists || !loadExchange.exists || !loadToken0
    .exists || !loadToken1.exists){
    //throw some error/warning
  }

  let pair = loadPair.entity
  let exchange = loadExchange.entity
  let token0 = loadToken0.entity
  let token1 = loadToken1.entity
  //sync does not modify anything with exchange

  // reset token total liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

  if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1)
  else pair.token0Price = ZERO_BD
  if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0)
  else pair.token1Price = ZERO_BD

  pair.save()

  token0.ethPrice = findEthPerToken(token0 as Token)
  token1.ethPrice = findEthPerToken(token1 as Token)
  token0.save()
  token1.save()

  let loadBundle = safeLoadBundle('ethUsdPrice')
  if(!loadBundle.exists){
    //throw some error
  }
  let ethUsdPrice = loadBundle.entity
  ethUsdPrice.value = getEthPriceInUSD()
  ethUsdPrice.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (ethUsdPrice.value.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(pair.reserve0, token0 as Token, pair.reserve1, token1 as Token).div(
      ethUsdPrice.value
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  pair.reserveETH = pair.reserve0
    .times(token0.ethPrice as BigDecimal)
    .plus(pair.reserve1.times(token1.ethPrice as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(ethUsdPrice.value)

  // use tracked amounts globally
  exchange.totalLiquidityETH = exchange.totalLiquidityETH.plus(trackedLiquidityETH)
  exchange.totalLiquidityUSD = exchange.totalLiquidityETH.times(ethUsdPrice.value)

  // now correctly set liquidity amounts for each token
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

  // save entities
  pair.save()
  exchange.save()
  token0.save()
  token1.save()
}

// export function handleMint(event: Mint): void {
//   let transaction = Transaction.load(event.transaction.hash.toHexString())

//   let pair = ExchangePair.load(event.address.toHex())
//   let exchange = Exchange.load(pair.exchange)

//   let token0 = Token.load(pair.token0)
//   let token1 = Token.load(pair.token1)

//   // update exchange info (except balances, sync will cover that)
//   let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
//   let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

//   // update txn counts
//   token0.txCount = token0.txCount.plus(ONE_BI)
//   token1.txCount = token1.txCount.plus(ONE_BI)

//   // get new amounts of USD and ETH for tracking
//   let bundle = Bundle.load('1')
//   let amountTotalUSD = token1.ethPrice
//     .times(token1Amount)
//     .plus(token0.ethPrice.times(token0Amount))
//     .times(bundle.ethUsdPrice)

//   // update txn counts
//   pair.txCount = pair.txCount.plus(ONE_BI)

//   // save entities
//   token0.save()
//   token1.save()
//   pair.save()
//   exchange.save()
// }

// export function handleBurn(event: Burn): void {
//   let transaction = Transaction.load(event.transaction.hash.toHexString())

//   // safety check
//   if (transaction === null) {
//     return
//   }

//   let pair = ExchangePair.load(event.address.toHex())
//   let exchange = Exchange.load(pair.exchange)

//   //update token info
//   let token0 = Token.load(pair.token0)
//   let token1 = Token.load(pair.token1)
//   let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
//   let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

//   // update txn counts
//   token0.txCount = token0.txCount.plus(ONE_BI)
//   token1.txCount = token1.txCount.plus(ONE_BI)

//   // get new amounts of USD and ETH for tracking
//   let bundle = Bundle.load('1')
//   let amountTotalUSD = token1.ethPrice
//     .times(token1Amount)
//     .plus(token0.ethPrice.times(token0Amount))
//     .times(bundle.ethUsdPrice)

//   // update global counter and save
//   token0.save()
//   token1.save()
//   pair.save()
//   exchange.save()
// }

// export function handleSwap(event: Swap): void {
//   let pair = ExchangePair.load(event.address.toHexString())
//   let token0 = Token.load(pair.token0)
//   let token1 = Token.load(pair.token1)
//   let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals)
//   let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals)
//   let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals)
//   let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals)

//   // totals for volume updates
//   let amount0Total = amount0Out.plus(amount0In)
//   let amount1Total = amount1Out.plus(amount1In)

//   // ETH/USD prices
//   let bundle = Bundle.load('1')

//   // get total amounts of derived USD and ETH for tracking
//   let derivedAmountETH = token1.ethPrice
//     .times(amount1Total)
//     .plus(token0.ethPrice.times(amount0Total))
//     .div(BigDecimal.fromString('2'))
//   let derivedAmountUSD = derivedAmountETH.times(bundle.ethUsdPrice)

//   // only accounts for volume through white listed tokens
//   let trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0 as Token, amount1Total, token1 as Token, pair as Pair)

//   let trackedAmountETH: BigDecimal
//   if (bundle.ethUsdPrice.equals(ZERO_BD)) {
//     trackedAmountETH = ZERO_BD
//   } else {
//     trackedAmountETH = trackedAmountUSD.div(bundle.ethUsdPrice)
//   }

//   // update token0 global volume and token liquidity stats
//   token0.tradeVolume = token0.tradeVolume.plus(amount0In.plus(amount0Out))
//   token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD)

//   // update token1 global volume and token liquidity stats
//   token1.tradeVolume = token1.tradeVolume.plus(amount1In.plus(amount1Out))
//   token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD)

//   // update txn counts
//   token0.txCount = token0.txCount.plus(ONE_BI)
//   token1.txCount = token1.txCount.plus(ONE_BI)

//   // update pair volume data, use tracked amount if we have it as its probably more accurate
//   pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
//   pair.token0Volume = pair.token0Volume.plus(amount0Total)
//   pair.token1Volume = pair.token1Volume.plus(amount1Total)
//   pair.txCount = pair.txCount.plus(ONE_BI)
//   pair.save()

//   // update global values, only used tracked amounts for volume
//   let exchange = Exchange.load(pair.exchange)
//   exchange.totalVolumeUSD = exchange.totalVolumeUSD.plus(trackedAmountUSD)
//   exchange.totalVolumeETH = exchange.totalVolumeETH.plus(trackedAmountETH)

//   // save entities
//   pair.save()
//   token0.save()
//   token1.save()
//   exchange.save()

//   let transaction = Transaction.load(event.transaction.hash.toHexString())
//   if (transaction === null) {
//     transaction = new Transaction(event.transaction.hash.toHexString())
//     transaction.blockNumber = event.block.number
//     transaction.timestamp = event.block.timestamp
//     transaction.mints = []
//     transaction.swaps = []
//     transaction.burns = []
//   }
//   let swaps = transaction.swaps
//   let swap = new SwapEvent(event.transaction.hash.toHex().concat(event.address.toHex()))

//   // update swap event
//   swap.transaction = transaction.id
//   swap.pair = pair.id
//   swap.timestamp = transaction.timestamp
//   swap.transaction = transaction.id
//   swap.sender = event.params.sender
//   swap.amount0In = amount0In
//   swap.amount1In = amount1In
//   swap.amount0Out = amount0Out
//   swap.amount1Out = amount1Out
//   swap.to = event.params.to
//   swap.from = event.transaction.from
//   swap.logIndex = event.logIndex
//   // use the tracked amount if we have it
//   swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
//   swap.save()

//   // update the transaction

//   // TODO: Consider using .concat() for handling array updates to protect
//   // against unintended side effects for other code paths.
//   swaps.push(swap.id)
//   transaction.swaps = swaps
//   transaction.save()
// }
