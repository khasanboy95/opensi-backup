import type {Provider} from './types';
export const isTextModel=(provider:Provider,model:string)=>provider.protocol!=='gemini-image'&&!/(?:image|imagen|banana|omni|tts|asr|voiceclone|voicedesign|embedding|whisper|dall-e|veo|sora|lyria)/i.test(model);
