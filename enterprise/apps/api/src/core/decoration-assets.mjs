// Exact niucloud DIY assets, MIT; see docs/reference-projects/niucloud/LICENSE.
export const decorationBuiltins=[
 "active_cube/active_cube_bg.png",
 "active_cube/bg_2.png",
 "active_cube/block_style1_1.png",
 "active_cube/active_cube_text1.png",
 "active_cube/active_cube_goods1.png",
 "active_cube/active_cube_goods2.png",
 "active_cube/active_cube_goods3.png",
 "active_cube/active_cube_goods4.png",
 "active_cube/active_cube_goods5.png",
 "active_cube/active_cube_goods6.png",
 "active_cube/active_cube_goods7.png",
 "active_cube/active_cube_goods8.png",
 "picture_show/picture_05.png",
 "picture_show/picture_06.png",
 "picture_show/picture_07.png",
 "picture_show/picture_08.png",
 "picture_show/picture_show_head_text3.png",
 "picture_show/picture_show_head_text4.png"
];
export function decorationBuiltinUrl(name,mini=false){return decorationBuiltins.includes(name)?(mini?'/static/decoration/niu/':'/decoration/niu/')+name:''}
