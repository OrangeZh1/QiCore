import {Fault} from './errors.mjs';
export function byteRange(header,total){
 if(!header)return null;
 const bad=()=>{throw Object.assign(new Fault('RANGE_NOT_SATISFIABLE','请求范围无效',416),{size:total})};
 const m=/^bytes=(\d*)-(\d*)$/.exec(header);if(!m||!m[1]&&!m[2]||total<=0)return bad();
 let start=m[1]?Number(m[1]):Math.max(0,total-Number(m[2])),end=m[1]&&m[2]?Number(m[2]):total-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!m[1]&&(!Number.isSafeInteger(Number(m[2]))||Number(m[2])<=0)||start<0||start>=total||end<start)return bad();
 end=Math.min(end,total-1);return{start,end,total};
}
