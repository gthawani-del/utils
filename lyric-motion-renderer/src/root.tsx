import React from 'react';
import {Composition} from 'remotion';
import {LyricHero} from './scene';
import project from '../examples/project.json';

export const Root: React.FC = () => (
  <Composition id="LyricHero" component={LyricHero} width={project.width} height={project.height}
    fps={project.fps} durationInFrames={Math.round(project.fps * project.durationSeconds)}
    defaultProps={{project}} calculateMetadata={({props}) => ({
      width: props.project.width, height: props.project.height, fps: props.project.fps,
      durationInFrames: Math.round(props.project.durationSeconds * props.project.fps),
    })}/>
);
