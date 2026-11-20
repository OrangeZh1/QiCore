import type {DecorationBlock} from '../../../api/src/core/decoration-types'
export type DecorationDrag={id:string}|{type:string}
// Same insertion-boundary model as school-shop, without its profile-page restriction.
export function placeDecorationBlock(blocks:DecorationBlock[],drag:DecorationDrag,at:number,create:(type:string)=>DecorationBlock){
 const next=[...blocks];at=Math.max(0,Math.min(next.length,at))
 if('id' in drag){const from=next.findIndex(b=>b.id===drag.id);if(from<0)return null;const [block]=next.splice(from,1);const to=from<at?at-1:at;if(to===from)return null;next.splice(to,0,block!);return {blocks:next,id:block!.id}}
 if(next.length>=30)return null;const block=create(drag.type);next.splice(at,0,block);return {blocks:next,id:block.id}
}
