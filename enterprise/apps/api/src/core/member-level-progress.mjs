const unsigned=value=>typeof value==='string'&&/^\d+$/.test(value)||Number.isSafeInteger(value)&&value>=0;
const amount=value=>{const n=BigInt(value);return '¥'+(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0')};
const count=value=>String(value).replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function levelProgress(conditions,metrics){
 return Object.entries(conditions).map(([key,target])=>{
  const current=metrics[key],known=unsigned(current),required=BigInt(target),value=known?BigInt(current):null,remaining=value===null?null:required>value?required-value:0n;
  const format=value=>key==='paidCents'?amount(value):count(value);
  return{key,label:{growth:'成长值',paidCents:'累计实付金额',paidOrders:'有效订单数'}[key],current:known?String(current):null,target:String(target),currentText:known?format(current):'待获取',targetText:format(target),remainingText:remaining===null?'待获取':format(remaining),met:value===null?null:value>=required,percent:value===null?null:required===0n?100:Number((value>=required?required:value)*10000n/required)/100};
 });
}
