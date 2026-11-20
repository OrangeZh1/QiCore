export type WindowMetrics={windowWidth:number;statusBarHeight?:number}
export type MenuMetrics={width:number;height:number;top:number;left:number}
export function navigationFrame(layout:ReturnType<typeof navigationLayout>,web=false){
 const safe='env(safe-area-inset-top, 0px)';
 return web?{paddingTop:`calc(var(--client-navigation-top, 12px) + ${safe})`,height:`calc(${layout.rowHeight}px + var(--client-navigation-top, 12px) + ${safe})`}:{paddingTop:layout.statusBar+'px',height:layout.totalHeight+'px'}
}
export function navigationLayout(windowInfo?:WindowMetrics,menu?:MenuMetrics){
 const statusBar=windowInfo?Math.max(0,windowInfo.statusBarHeight||0):0
 let rowHeight=44,rightSpace=windowInfo?104:14
 if(windowInfo&&menu&&menu.width>0&&menu.height>0&&menu.left>0&&menu.left<windowInfo.windowWidth&&menu.top>=statusBar){
  rowHeight=Math.max(44,(menu.top-statusBar)*2+menu.height)
  rightSpace=windowInfo.windowWidth-menu.left+8
 }
 return{statusBar,rowHeight,rightSpace,totalHeight:statusBar+rowHeight}
}
