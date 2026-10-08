import React from 'react';
import {AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

type Word = {word:string;start:number;end:number};
type Project = {title?:string;audio?:string;background?:string;accent?:string;words:Word[];beats?:number[]};
export const LyricHero:React.FC<{project:Project}> = ({project}) => {
 const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const t=frame/fps;
 const accent=project.accent || '#f75b56';
 const active=Math.max(0,project.words.findIndex((w)=>t>=w.start && t<w.end));
 const endIndex=project.words.findIndex(w=>t<w.end);
 const selected=endIndex<0?project.words.length-1:endIndex;
 const progress=Math.min(1,Math.max(0,t/5));
 const pulse=(project.beats || []).reduce((max,b)=>Math.max(max,Math.max(0,1-Math.abs(t-b)/0.22)),0);
 const orbit=interpolate(t,[1.1,3.3],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 return <AbsoluteFill style={{background:project.background || '#101018',color:'#f7f4ea',overflow:'hidden',fontFamily:'system-ui, sans-serif'}}>
   <AbsoluteFill style={{opacity:0.17,backgroundImage:'radial-gradient(circle at 28% 21%, #ffffff 0, transparent 30%), repeating-linear-gradient(0deg,transparent 0,transparent 5px,#ffffff0b 6px)'}}/>
   <div style={{position:'absolute',top:'18%',left:90,fontSize:45,fontWeight:600,letterSpacing:9,opacity:0.6}}>{project.title || 'LYRIC MOTION'}</div>
   <div style={{position:'absolute',top:'37%',left:65,right:110,display:'flex',flexWrap:'wrap',gap:'24px 30px',alignItems:'baseline'}}>
   {project.words.map((w,i)=>{
    const enter=spring({frame:frame-Math.round(w.start*fps),fps,config:{damping:18,stiffness:140,mass:1},durationInFrames:24});
    const lit=(selected===i);
    return <span key={i} style={{fontSize:lit?116:88,fontWeight:900,letterSpacing:-4,color:lit?accent:'#f7f4ea',opacity:Math.max(0.23,enter),transform:`translateY(${(1-enter)*45}px)`,display:'inline-block',textShadow:lit?`0 12px 65px ${accent}33`:'none'}}>{w.word}</span>;
   })}
   </div>
   <svg viewBox="0 0 1080 1920" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
    <path d="M 90 1160 Q 390 1130 720 1160" stroke={accent} strokeWidth={10+7*pulse} fill="none" strokeLinecap="round" strokeDasharray="690" strokeDashoffset={690*(1-interpolate(t,[0.25,1.4],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}))}/>
    <circle cx="790" cy="1220" r={140+35*pulse} stroke={accent} strokeWidth="7" fill="none" strokeDasharray="880" strokeDashoffset={880*(1-orbit)} transform={`rotate(${progress*70} 790 1220)`}/>
   </svg>
   <div style={{position:'absolute',bottom:'19%',left:95,right:155,height:3,background:'#ffffff22'}}>
    <div style={{height:'100%',width:`${progress*100}%`,background:accent}}/>
   </div>
   {project.audio && <Audio src={staticFile(project.audio)}/>}
 </AbsoluteFill>;
};
