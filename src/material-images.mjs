import sharp from 'sharp'
import {fileTypeFromBuffer} from 'file-type'
import {z} from 'zod'
import {fail} from './media/errors.mjs'
export const selectionTransform={shape:z.enum(['square','banner']).optional(),fit:z.enum(['cover','contain']).optional(),size:z.number().int().refine(n=>[100,256,512].includes(n)).optional()};
export async function normalizeSelectedImage(bytes,options={}){let result;try{result=await sharp(bytes,{limitInputPixels:16000000,animated:false}).rotate().resize(options.size||256,options.shape==='banner'?Math.round((options.size||256)*.4):options.size||256,{fit:options.fit||'cover',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:80}).toBuffer()}catch{fail('MATERIAL_IMAGE_INVALID','图片无法解析或尺寸过大，请重新选择')}if(result.length>80000)fail('MATERIAL_IMAGE_INVALID','图片压缩后仍过大，请更换图片');return 'data:image/webp;base64,'+result.toString('base64')}
export async function normalizeMaterial(bytes,filename){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>100*1024*1024)fail('MATERIAL_SIZE_INVALID','请选择 100 MB 以内的非空文件');
  let detected;try{detected=await fileTypeFromBuffer(bytes)}catch{fail('MATERIAL_FORMAT_INVALID','文件内容不完整或格式无法识别')}
  if(/\.(png|jpe?g|webp)$/i.test(filename)&&!['image/jpeg','image/png','image/webp'].includes(detected?.mime))fail('MATERIAL_FORMAT_INVALID','图片内容与文件格式不匹配');
  if(detected?.mime.startsWith('image/')){
    if(!['image/jpeg','image/png','image/webp'].includes(detected.mime))fail('MATERIAL_FORMAT_INVALID','图片仅支持静态 JPG、PNG、WebP');
    try{const pipeline=sharp(bytes,{limitInputPixels:16000000,animated:false}),meta=await pipeline.metadata();if(meta.pages>1)throw Error('ANIMATED');const data=await pipeline.rotate().resize(2400,2400,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();return{data,kind:'image',mime:'image/webp',extension:'webp',name:filename.replace(/\.[^.]+$/,'').slice(0,170)+'.webp'}}catch{fail('MATERIAL_FORMAT_INVALID','图片无法解码或尺寸过大')}
  }
  if(['video/mp4','video/webm'].includes(detected?.mime))return{data:bytes,kind:'video',mime:detected.mime,extension:detected.ext,name:filename};
  // Other files are always attachments, never interpreted as a document on the application origin.
  return{data:bytes,kind:'file',mime:'application/octet-stream',extension:'bin',name:filename};
}

export async function validateSelectedImage(value) {
  if (typeof value !== 'string' || value.length > 106700 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail('MATERIAL_IMAGE_INVALID', '请选择素材库中的图片')
  }
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
  try {
    const image = sharp(bytes, { limitInputPixels: 16000000 })
    const meta = await image.metadata()
    if (meta.format !== 'webp' || !meta.width || !meta.height || meta.pages > 1 || bytes.length > 80000) throw Error()
    await image.stats()
  } catch {
    fail('MATERIAL_IMAGE_INVALID', '图片无法解析或尺寸过大')
  }
  return value
}
export async function assertMaterialImages(db, ids, scope = 'shared') {
  const requested = [...new Set(ids)]
  if (!requested.length) return
  const count = await db.coreMaterial.count({ where: { id: { in: requested }, scopeKey: { in: ['shared', scope] }, kind: 'image', status: 'ready', deletedAt: null } })
  if (count !== requested.length) fail('MATERIAL_NOT_FOUND', '选用的图片不存在或不属于当前应用', 400)
}
