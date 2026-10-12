export const imageModels=['gemini-nano-banana-2.1','gemini-3.1-flash-image','gemini-3.1-flash-lite-image','gemini-3-pro-image','gemini-2.5-flash-image'];
export function imageRequest(value,asset){
 const parts=[{text:[value.text,value.style].filter(Boolean).join('\n')}];
 if(asset)parts.push({inlineData:{mimeType:asset.mime,data:asset.bytes.toString('base64')}});
 return {contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:value.aspectRatio||'1:1',...(value.model==='gemini-2.5-flash-image'?{}:{imageSize:'1K'})}}};
}
export function imageOutput(body){
 const part=body.candidates?.flatMap(c=>c.content?.parts||[]).find(p=>p.inlineData?.data&&!p.thought);
 if(!part)throw new Error(`Google rasm qaytarmadi: ${body.promptFeedback?.blockReason||body.candidates?.[0]?.finishReason||'bo‘sh javob'}`);
 const {data,mimeType}=part.inlineData;
 if(typeof data!=='string'||data.length>13_333_336||!['image/png','image/jpeg','image/webp'].includes(mimeType))throw new Error('Rasm formati yoki hajmi mos emas.');
 return {bytes:Buffer.from(data,'base64'),extension:{'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mimeType]};
}
export const supportsMedia=(provider,model,audioModels)=>provider.protocol==='gemini-image'?imageModels.includes(model)||model==='gemini-omni-1.1-flash':Boolean(audioModels[model])&&!imageModels.includes(model)&&model!=='gemini-omni-1.1-flash';
