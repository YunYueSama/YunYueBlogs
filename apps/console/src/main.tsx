import React from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation, MotionConfig } from 'motion/react';
import { App } from './App';
import './styles.css';
import './studio-polish.css';
import './integration-settings.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LazyMotion features={domAnimation}><MotionConfig reducedMotion="user"><App/></MotionConfig></LazyMotion></React.StrictMode>);
