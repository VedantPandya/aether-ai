"""Generate disclosed AI narration using the documented Speech API."""
import asyncio,json,sys
from pathlib import Path
from dotenv import load_dotenv
from openai import AsyncOpenAI
ROOT=Path(__file__).resolve().parents[2];load_dotenv(ROOT/'.env')
OUT=ROOT/'demo-video/source/audio-natural';OUT.mkdir(parents=True,exist_ok=True)
LINES={'hook': 'Space is vast. And the farther we go, the harder it becomes to guide every move from Earth. Can AI help us find our way?', 'meet': 'Meet Aether. An autonomous mission-control companion, built to turn a goal into action.', 'rover': 'On Mars, the job is simple: reach the next waypoint. Then we put a boulder in the way. Aether checks the route, tests a dozen alternatives, and chooses a safer path. ', 'arrival': 'The rover steers around the obstacle, and reaches its goal.', 'architecture': 'Three layers make that possible. Physics and PID steer. Reflexes spot trouble. Strategy looks ahead. On the server, we use the Decisions API for fast calls, and a reasoning model for the harder ones.', 'credits': 'GPT Image gave Aether its expressions. GPT six Astra helped create the custom spacecraft. And voice mode lets you talk things through with Aether.', 'outro': 'We cannot guide every step from Earth. But perhaps we can teach our explorers to find their way.'}
async def main():
 async with AsyncOpenAI(timeout=60,max_retries=0) as client:
  async def create(name,text):
   target=OUT/(name+'.wav')
   # Cached clips keep their full provenance record, so re-running never loses it.
   if target.exists():return {'name':name,'text':text,'model':'gpt-4o-mini-tts','voice':'marin','ai_generated':True}
   async with client.audio.speech.with_streaming_response.create(model='gpt-4o-mini-tts',voice='marin',input=text,instructions='Tell this as someone quietly sharing a project they care about with a friend. Warm, grounded, thoughtful, lightly British English. Natural conversational rhythm, contractions, and short breathing pauses. Understated curiosity. No announcer voice, sales pitch, theatrical gravitas, exaggerated enthusiasm, or perfectly even cadence. Pronounce Aether as ee-ther.',response_format='wav',speed=1.0) as response:await response.stream_to_file(target)
   print('Generated narration:',name,flush=True)
   return {'name':name,'text':text,'model':'gpt-4o-mini-tts','voice':'marin','ai_generated':True}
  results=await asyncio.gather(*(create(n,t) for n,t in LINES.items()))
 (OUT/'provenance.json').write_text(json.dumps(results,indent=2))
if __name__=='__main__':asyncio.run(main())
