export function transitionReceipt(f){
 const current=f.client.status().receipt;
 // Reuse the signed interval exactly: a later Date.now() would exceed online_valid_until.
 const envelope=f.envelope({...current,refresh_after:current.online_valid_until});
 f.client.acceptReceipt(envelope);return envelope;
}
