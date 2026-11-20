export type OfficialMenu={name:string;type:'view'|'miniprogram'|'group';url:string;appId:string;pagePath:string;children:OfficialMenu[]}
export type OfficialTemplate={id:string;name:string;templateId:string;enabled:boolean;remark:string}
export type OfficialReply={enabled:boolean;type?:'text'|'image'|'video'|'news'|'miniprogram';text:string;materialId?:string|null;coverMaterialId?:string|null;title?:string;description?:string;url?:string;appId?:string;pagePath?:string}
export type OfficialKeyword=OfficialReply&{id:string;name:string;keyword:string;match:'exact'|'contains'}
export type OfficialReplies={welcome:OfficialReply;fallback:OfficialReply;keywords:OfficialKeyword[]}
export type OfficialConfig={enabled:boolean;displayName:string;originalId:string;appId:string;accountType:string;qrMaterialId:string|null;messageEnabled:boolean;messageMode:'plain'|'compatible'|'safe';menu:OfficialMenu[];templates:OfficialTemplate[];replies:OfficialReplies}
