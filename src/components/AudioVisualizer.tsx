import { useEffect, useRef } from "react";
import { SessionState } from "../types";

interface AudioVisualizerProps {
  state: SessionState;
  analyser: AnalyserNode | null;
}

export default function AudioVisualizer({ state, analyser }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI screens
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      if (!ctx || !canvas) return;
      
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      
      ctx.clearRect(0, 0, width, height);

      let volume = 0;
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        volume = sum / dataArray.length; // Range approx [0, 255]
      }

      // Phase updates faster in active states
      let speed = 0.05;
      if (state === SessionState.SPEAKING) speed = 0.15 + (volume / 255) * 0.1;
      if (state === SessionState.LISTENING) speed = 0.12;
      if (state === SessionState.CONNECTING) speed = 0.25;
      
      phaseRef.current += speed;

      // Draw futuristic visual based on session state
      if (state === SessionState.DISCONNECTED) {
        // Flat, slightly vibrating calm line
        drawSineWave(ctx, width, height, 0.015, 2, 0.2, phaseRef.current, "rgba(244, 63, 94, 0.2)");
        drawCenterCore(ctx, width, height, 45, "rgba(244, 63, 94, 0.05)", "rgba(244, 63, 94, 0.3)");
      } 
      else if (state === SessionState.CONNECTING) {
        // Fast spinning orbits
        drawCenterCore(ctx, width, height, 50, "rgba(236, 72, 153, 0.08)", "rgba(236, 72, 153, 0.5)");
        drawOrbitLoading(ctx, width, height, phaseRef.current);
      } 
      else if (state === SessionState.IDLE) {
        // Deep slow breathing waves
        const baseAmp = 8;
        const breathingFactor = Math.sin(phaseRef.current * 0.3) * 3 + 4;
        
        drawSineWave(ctx, width, height, 0.01, breathingFactor, 1, phaseRef.current, "rgba(244, 63, 94, 0.15)");
        drawSineWave(ctx, width, height, 0.015, breathingFactor * 0.7, 1.5, -phaseRef.current * 0.8, "rgba(236, 72, 153, 0.1)");
        drawCenterCore(ctx, width, height, 50 + breathingFactor * 0.5, "rgba(236, 72, 153, 0.1)", "rgba(236, 72, 153, 0.4)");
      } 
      else if (state === SessionState.LISTENING) {
        // Dynamic, high-frequency microphone response
        const micAmp = 12 + (volume / 255) * 60;
        
        drawSineWave(ctx, width, height, 0.02, micAmp, 1.2, phaseRef.current, "rgba(236, 72, 153, 0.25)");
        drawSineWave(ctx, width, height, 0.03, micAmp * 0.6, 2.0, -phaseRef.current * 1.2, "rgba(244, 63, 94, 0.18)");
        drawSineWave(ctx, width, height, 0.01, micAmp * 0.4, 0.8, phaseRef.current * 0.5, "rgba(217, 70, 239, 0.15)");
        
        drawMicFluids(ctx, width, height, volume);
        drawCenterCore(ctx, width, height, 50 + (volume / 255) * 30, "rgba(236, 72, 153, 0.15)", "rgba(236, 72, 153, 0.6)");
      } 
      else if (state === SessionState.SPEAKING) {
        // Extremely expressive output waves
        const speakAmp = 20 + (volume / 255) * 110;
        
        // Siri-like overlay
        drawSineWave(ctx, width, height, 0.012, speakAmp, 1.8, phaseRef.current, "rgba(236, 72, 153, 0.4)");
        drawSineWave(ctx, width, height, 0.02, speakAmp * 0.7, 2.5, -phaseRef.current * 0.9, "rgba(244, 63, 94, 0.3)");
        drawSineWave(ctx, width, height, 0.008, speakAmp * 0.4, 1.1, phaseRef.current * 0.4, "rgba(217, 70, 239, 0.25)");
        drawSineWave(ctx, width, height, 0.025, speakAmp * 0.2, 3.2, -phaseRef.current * 1.5, "rgba(168, 85, 247, 0.2)");

        drawCenterCore(ctx, width, height, 52 + (volume / 255) * 45, "rgba(244, 63, 94, 0.22)", "rgba(244, 63, 94, 0.75)");
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state, analyser]);

  // Wave rendering helper
  const drawSineWave = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
     frequency: number,
    amplitude: number,
    wavelength: number,
    phase: number,
    color: string
  ) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    const centerY = height / 2;

    for (let x = 0; x < width; x += 3) {
      // Create a nice feathering window at the edges so the wave fades to zero near the left/right boundaries
      const edgeFeather = Math.sin((x / width) * Math.PI);
      const y = centerY + Math.sin(x * frequency * wavelength + phase) * amplitude * edgeFeather;
      
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  };

  // Center radial orb helper
  const drawCenterCore = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    radius: number,
    fillColor: string,
    glowColor: string
  ) => {
    const cx = width / 2;
    const cy = height / 2;

    ctx.save();
    
    // Core outer glow
    ctx.shadowBlur = radius * 0.6;
    ctx.shadowColor = glowColor;
    
    // Radial glow gradient
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    grad.addColorStop(0.3, "rgba(253, 244, 255, 0.9)");
    grad.addColorStop(0.7, fillColor);
    grad.addColorStop(1, "rgba(236, 72, 153, 0)");

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  };

  // Loading animation orbits
  const drawOrbitLoading = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number
  ) => {
    const cx = width / 2;
    const cy = height / 2;
    const radius = 62;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(236, 72, 153, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Two orbiting orbital dots
    for (let i = 0; i < 2; i++) {
      const angle = phase + i * Math.PI;
      const dotX = cx + Math.cos(angle) * radius;
      const dotY = cy + Math.sin(angle) * radius;

      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = "rgba(236, 72, 153, 0.9)";
      ctx.fillStyle = "#ec4899";
      ctx.beginPath();
      ctx.arc(dotX, dotY, i === 0 ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  // Microphonic fluid circles in listening state
  const drawMicFluids = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    volume: number
  ) => {
    const cx = width / 2;
    const cy = height / 2;
    const maxCircles = 3;

    for (let i = 0; i < maxCircles; i++) {
      // Offset wave rings
      const pulsePhase = (phaseRef.current * 0.15 + i / maxCircles) % 1.0;
      const ringRadius = 50 + pulsePhase * 120 + (volume / 255) * 40;
      const opacity = (1.0 - pulsePhase) * 0.28;

      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(236, 72, 153, ${opacity})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  };

  return (
    <div className="w-full h-56 relative flex items-center justify-center">
      {/* Background sci-fi holographic radar ring */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-48 h-48 rounded-full border border-pink-500/5 animate-[spin_40s_linear_infinite]" />
        <div className="absolute w-36 h-36 rounded-full border border-dashed border-pink-500/10 animate-[spin_20s_linear_infinite]" />
      </div>

      <canvas
        id="voice-canvas-stage"
        ref={canvasRef}
        className="w-full h-full absolute inset-0 max-w-lg mx-auto"
      />
    </div>
  );
}
