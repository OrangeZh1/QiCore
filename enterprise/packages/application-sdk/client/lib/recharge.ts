export function rechargeCents(input:string):number|null{
 const value=input.trim();if(!/^\d+(\.\d{1,2})?$/.test(value))return null
 const [whole,fraction='']=value.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 return Number.isSafeInteger(cents)&&cents>0?cents:null
}
