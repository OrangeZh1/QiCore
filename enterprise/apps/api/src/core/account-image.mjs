import sharp from 'sharp';
import {fileTypeFromBuffer} from 'file-type';
import {fail} from './errors.mjs';
export async function normalizeAccountImage(value,{size=256,height=size,fit='cover',lossless=false,storage=null,siteId=null}={}){
  if(value==null)return null;
  if(storage&&typeof value==='string'&&(value.startsWith('https://')||value.startsWith('/api/v1/public/site-assets/')))return storage.imageReference(value,siteId);
  if(typeof value!=='string'||value.length>120000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))fail('IMAGE_INVALID','请选择有效的 JPG、PNG 或 WebP 图片');
  try{
    const bytes=Buffer.from(value.split(',')[1],'base64'),detected=await fileTypeFromBuffer(bytes);
    if(!['image/png','image/jpeg','image/webp'].includes(detected?.mime))throw Error('FORMAT');
    const pipeline=sharp(bytes,{limitInputPixels:16000000,animated:false});
    const meta=await pipeline.metadata();if(!['png','jpeg','webp'].includes(meta.format))throw Error('FORMAT');
    const image=await pipeline.rotate().resize(size,height,{fit,background:{r:0,g:0,b:0,alpha:0}}).webp({quality:80,lossless}).toBuffer();
    if(image.length>80000)throw Error('SIZE');return storage?await storage.saveImage(image,'image/webp',{siteId}):'data:image/webp;base64,'+image.toString('base64');
  }catch{fail('IMAGE_INVALID','图片无法解析或尺寸过大，请重新选择')}
}
