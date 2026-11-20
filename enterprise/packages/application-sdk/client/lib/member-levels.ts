import type {LevelCriterion} from '@qicore/application-sdk/browser/decoration-types'
export type {LevelCriterion} from '@qicore/application-sdk/browser/decoration-types'
export type MemberLevel={id:string|null;name:string;rank:number;description:string;defined:boolean;upgradeMode:'all'|'any';criteria:LevelCriterion[];benefits:{key:string;label:string;value:number;unit:string}[]}
export type MemberLevelsView={current:MemberLevel;growth:number;levels:MemberLevel[];nextId:string|null;nextState:'automatic'|'manual'|'highest'|'empty';profile:{name:string;avatar:string|null};growthRules:{registration:number;perYuan:number}}
export const levelKey=(level:MemberLevel)=>level.id??'base'
