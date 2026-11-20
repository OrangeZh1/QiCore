export async function walletSummary(db, scope, userId) {
  const rows = await db.coreConsumerWallet.findMany({
    where: { scope, userId, asset: { in: ['balance', 'points'] } },
    select: { asset: true, amount: true, version: true },
  })
  const summary = { points: { amount: 0, version: 0 }, balance: { amount: 0, version: 0 } }
  for (const row of rows) {
    const amount = Number(row.amount)
    if (!Number.isSafeInteger(amount)) throw Error('钱包金额超出安全整数范围')
    summary[row.asset] = { amount, version: row.version }
  }
  return summary
}
