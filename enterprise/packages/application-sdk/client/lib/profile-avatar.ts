import {isH5} from './api'

// Both clients submit the existing bounded inline-image contract; the server validates the bytes.
export async function profileAvatar(path:string,component:any):Promise<string>{
 if(isH5){
  const image=new Image();image.src=path;await image.decode()
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256
  const context=canvas.getContext('2d');if(!context)throw Error('无法处理头像，请重新选择')
  const size=Math.min(image.naturalWidth,image.naturalHeight)
  context.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,256,256)
  return canvas.toDataURL('image/jpeg',.85)
 }
 const info=await uni.getImageInfo({src:path}),size=Math.min(info.width,info.height),context=uni.createCanvasContext('profile-avatar',component)
 context.drawImage(info.path,(info.width-size)/2,(info.height-size)/2,size,size,0,0,256,256)
 await new Promise<void>(resolve=>context.draw(false,()=>resolve()))
 const file=await new Promise<string>((resolve,reject)=>uni.canvasToTempFilePath({canvasId:'profile-avatar',width:256,height:256,destWidth:256,destHeight:256,fileType:'jpg',quality:.85,success:r=>resolve(r.tempFilePath),fail:reject},component))
 const base64=await new Promise<string>((resolve,reject)=>uni.getFileSystemManager().readFile({filePath:file,encoding:'base64',success:r=>resolve(String(r.data)),fail:reject}))
 return 'data:image/jpeg;base64,'+base64
}
