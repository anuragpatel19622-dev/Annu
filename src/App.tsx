import { useState, useRef, useEffect } from "react";
import { 
  motion, 
  AnimatePresence 
} from "motion/react";
import { 
  Mic, 
  Power, 
  Volume2, 
  AlertCircle, 
  Sparkles, 
  RefreshCw, 
  ExternalLink,
  Info
} from "lucide-react";

import { SessionState, AssistantLog, ToolCallData } from "./types";
import { floatTo16BitPCM, arrayBufferToBase64, pcmToAudioBuffer } from "./utils/audio";
import AudioVisualizer from "./components/AudioVisualizer";
import HistoryTray from "./components/HistoryTray";

// Fun sassy statuses when Lola is loading or connecting
const SASSY_CONNECTING_PROMPTS = [
  "Awakening Lola... Don't hold your breath, babe.",
  "Fetching some makeup, wait a sec...",
  "Warming up my sassy circuits for you...",
  "Getting ready to judge your music taste...",
  "Powering up. Try to act smart while I load..."
];

const SASSY_IDLE_PROMPTS = [
  "She's listening to you, babe. Whisper something...",
  "Tell me a secret, sweetheart. I promise I'll laugh.",
  "I'm all ears. Don't stutter now!",
  "Cat got your tongue, genius?",
  "Say something clever or let's wrap this up."
];

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>(SessionState.DISCONNECTED);
  const [logs, setLogs] = useState<AssistantLog[]>([]);
  const [toolsActivated, setToolsActivated] = useState<ToolCallData[]>([]);
  const [captions, setCaptions] = useState("");
  const [currentVibe, setCurrentVibe] = useState("Teasing");
  const [errorText, setErrorText] = useState<string | null>(null);

  // Dynamic sassy prompt selections
  const [connectingPrompt, setConnectingPrompt] = useState(SASSY_CONNECTING_PROMPTS[0]);
  const [idlePrompt, setIdlePrompt] = useState(SASSY_IDLE_PROMPTS[0]);

  // Toast for popups that are blocked
  const [popupToast, setPopupToast] = useState<{ url: string; name: string } | null>(null);

  // Audio nodes and references
  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const playbackAudioCtxRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  
  // Analysers for state visualizers
  const [userAnalyser, setUserAnalyser] = useState<AnalyserNode | null>(null);
  const [lolaAnalyser, setLolaAnalyser] = useState<AnalyserNode | null>(null);

  // Playback scheduler references
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const captionsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ping timer for keeping ws alive
  const keepAliveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Select a random sassy prompt on mount and during transitions
  useEffect(() => {
    setConnectingPrompt(SASSY_CONNECTING_PROMPTS[Math.floor(Math.random() * SASSY_CONNECTING_PROMPTS.length)]);
    setIdlePrompt(SASSY_IDLE_PROMPTS[Math.floor(Math.random() * SASSY_IDLE_PROMPTS.length)]);
  }, [sessionState]);

  // Clean-up on unmount
  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, []);

  const addLog = (type: "status" | "transcription" | "tool" | "error", text: string) => {
    const newLog: AssistantLog = {
      id: Math.random().toString(),
      timestamp: new Date(),
      type,
      text
    };
    setLogs((prev) => [...prev, newLog]);
  };

  /**
   * STOP playback immediately (critical for interruption support)
   */
  const stopPlayback = () => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (ignore) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  /**
   * Play dynamic PCM 24kHz base64 chunk from Lola
   */
  const queuePlaybackChunk = (base64PCM: string) => {
    try {
      // Lazy init playback context at 24kHz (Gemini stream rate)
      if (!playbackAudioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const playCtx = new AudioContextClass({ sampleRate: 24000 });
        playbackAudioCtxRef.current = playCtx;

        const analyser = playCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.connect(playCtx.destination);
        playbackAnalyserRef.current = analyser;
        setLolaAnalyser(analyser);
      }

      const playCtx = playbackAudioCtxRef.current;
      if (playCtx.state === "suspended") {
        playCtx.resume();
      }

      // Convert chunk to Web Audio buffer
      const buffer = pcmToAudioBuffer(playCtx, base64PCM, 24000);
      const source = playCtx.createBufferSource();
      source.buffer = buffer;
      
      // Route through our master speaker AnalyserNode for precise visualizer feedback!
      if (playbackAnalyserRef.current) {
        source.connect(playbackAnalyserRef.current);
      } else {
        source.connect(playCtx.destination);
      }

      const currentTime = playCtx.currentTime;
      // Prevent gap overlapping but handle initial latency delay buffer
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.05; // 50ms jitter buffer
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;

      activeSourcesRef.current.push(source);

      // Clean up source refs when done
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
        
        // If we are playing no speaker chunks and our session says speaking, return to idle/listening.
        if (activeSourcesRef.current.length === 0 && sessionState === SessionState.SPEAKING) {
          setSessionState(SessionState.LISTENING);
          captionsTimeoutRef.current = setTimeout(() => {
            setCaptions("");
          }, 3500); // Let captions linger for cinematic appeal
        }
      };

    } catch (err: any) {
      console.error("Failed to play Lola speaking chunk", err);
    }
  };

  /**
   * Connect WebSocket & Microphone
   */
  const connectSession = async () => {
    setErrorText(null);
    setSessionState(SessionState.CONNECTING);
    addLog("status", "Contacting Lola's dimension...");

    try {
      // 1. Ask for mic permission early so we can display errors immediately
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      // 2. Open full-stack API live-ws
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws`;
      addLog("status", `Bridging network connection over ${protocol}...`);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        addLog("status", "Connection handshake completed successfully.");
        // Initiate ping interval to avoid server timeouts (every 15s)
        keepAliveTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 15000);
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.error) {
            console.error("AI Server Error response:", msg.error);
            setErrorText(msg.error);
            addLog("error", msg.error);
            disconnectSession();
            return;
          }

          if (msg.connected) {
            addLog("status", "Lola is online. Voice streaming engaged.");
            setSessionState(SessionState.LISTENING);
            startMicStreaming(micStream);
            return;
          }

          // Handle audio spoken chunk
          if (msg.audio) {
            setSessionState(SessionState.SPEAKING);
            if (captionsTimeoutRef.current) {
              clearTimeout(captionsTimeoutRef.current);
            }
            queuePlaybackChunk(msg.audio);
          }

          // Handle speaker captions/text transcription
          if (msg.text) {
            setCaptions((prev) => prev + msg.text);
          }

          // Handle Interruption detection! (Gemini detected user speak while speaking)
          if (msg.interrupted) {
            addLog("status", "InterruptedException: User cut-in detected.");
            setCurrentVibe(prev => prev === "Teasing" ? "Playful" : "Teasing");
            stopPlayback();
            setSessionState(SessionState.LISTENING);
            setCaptions(" * Lola stops & listens *");
            captionsTimeoutRef.current = setTimeout(() => setCaptions(""), 1500);
          }

          // Handle Web Browser Functions Calls
          if (msg.toolCall?.functionCalls) {
            const calls = msg.toolCall.functionCalls;
            const toolResponses: any[] = [];

            for (const call of calls) {
              if (call.name === "openWebsite") {
                const { url, name } = call.args;
                addLog("tool", `Lola wants to take you to: ${name}`);
                
                // Track tool execution
                const toolId = call.id || Math.random().toString();
                const newTool: ToolCallData = {
                  id: toolId,
                  name: name || "Website",
                  url: url,
                  timestamp: new Date(),
                  status: "pending"
                };
                
                setToolsActivated((prev) => [newTool, ...prev]);

                // Try opening website instantly
                const win = window.open(url, "_blank");
                if (win) {
                  win.focus();
                  addLog("status", `Successfully navigated to: ${url}`);
                  newTool.status = "success";
                } else {
                  // Blocked by popup blocker
                  setPopupToast({ url, name });
                  addLog("status", `Redirect blocked by iframe sandbox constraint. Safe trigger rendered.`);
                  newTool.status = "failed";
                }

                // Append matching tool responses
                toolResponses.push({
                  id: call.id,
                  name: "openWebsite",
                  response: { 
                    output: { 
                      success: true, 
                      message: `Successfully opened website ${name} for our babe in another tab!` 
                    } 
                  }
                });
              }
            }

            // Instantly send function outputs to keep conversation seamless
            if (toolResponses.length > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ toolResponse: toolResponses }));
            }
          }

        } catch (e) {
          console.error("Failed to parse socket payload", e);
        }
      };

      ws.onclose = () => {
        addLog("status", "Lola disconnected. Rest in cyber peace.");
        setSessionState(SessionState.DISCONNECTED);
      };

      ws.onerror = (err) => {
        console.error("Socket error", err);
        addLog("error", "Secure WebSocket network socket failed.");
        disconnectSession();
      };

    } catch (err: any) {
      console.error("Session activation failed", err);
      setErrorText("Check microphone access permission: " + (err.message || String(err)));
      addLog("error", `Access Denied: ${err.message || String(err)}`);
      setSessionState(SessionState.DISCONNECTED);
    }
  };

  /**
   * Live microphone capture to web socket
   */
  const startMicStreaming = (stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputCtx;

      // Master mic volume analyser for client visual peaks
      const analyzer = inputCtx.createAnalyser();
      analyzer.fftSize = 256;
      setUserAnalyser(analyzer);

      const source = inputCtx.createMediaStreamSource(stream);
      source.connect(analyzer);

      // Create ScriptProcessor Node (legacy but 100% reliable for cross-browser float conversions)
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(inputCtx.destination);
      micProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmBuffer = floatTo16BitPCM(inputData);
          const base64PCM = arrayBufferToBase64(pcmBuffer);
          
          ws.send(JSON.stringify({ audio: base64PCM }));
        }
      };
    } catch (e: any) {
      console.error("Microphone capture bridge failed", e);
      addLog("error", "Failed to start microphone streaming.");
    }
  };

  /**
   * Shut down all streams, scopes and clean state
   */
  const disconnectSession = () => {
    setSessionState(SessionState.DISCONNECTED);
    stopPlayback();

    // Clear keep alive timer
    if (keepAliveTimerRef.current) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }

    // Shut down web socket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop mic stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // Stop mic audio context
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }

    // Clean processor nodes
    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }

    setCaptions("");
    setUserAnalyser(null);
  };

  // Human-friendly clear tool handler
  const handleClearHub = () => {
    setLogs([]);
    setToolsActivated([]);
    addLog("status", "Lola's registry has been updated and wiped clean!");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-between p-6 relative overflow-x-hidden selection:bg-pink-500/20">
      
      {/* Absolute Background Mesh Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f005_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f005_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_40%,#000_70%,transparent_100%)] pointer-events-none" />
      
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.06),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(168,85,247,0.04),transparent_40%)] pointer-events-none" />

      {/* Futuristic Header */}
      <header className="w-full max-w-lg flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-pink-500 animate-ping absolute inset-0" />
            <div className={`w-2.5 h-2.5 rounded-full ${sessionState !== SessionState.DISCONNECTED ? "bg-pink-500" : "bg-slate-500"}`} />
          </div>
          <h1 className="font-sans font-semibold tracking-wider text-sm text-slate-300">
            LOLA <span className="text-pink-500 font-light text-xs font-mono">LIVE_V1</span>
          </h1>
        </div>

        <div className="bg-slate-900/60 backdrop-blur-xs px-3 py-1.5 rounded-full border border-pink-500/10 flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">Vibe:</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20 font-bold font-sans">
            {currentVibe}
          </span>
        </div>
      </header>

      {/* Main Container Stage */}
      <main className="flex-1 w-full max-w-lg flex flex-col justify-center items-center z-10 mt-2">
        
        {/* Dynamic Warning Notification */}
        <AnimatePresence>
          {errorText && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-rose-950/80 border border-rose-500/30 text-rose-200 px-4 py-3 rounded-xl flex items-start gap-2.5 text-xs text-left max-w-sm mb-6 shadow-lg backdrop-blur-sm"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Hardware Block</p>
                <p className="text-[11px] opacity-80 leading-relaxed">{errorText}</p>
              </div>
            </motion.div>
          )}

          {/* Blocked popups safelink notification toast */}
          {popupToast && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-pink-950/90 border border-pink-500/30 p-3 rounded-xl flex items-center justify-between gap-4 max-w-sm mb-6 shadow-xl backdrop-blur-md"
            >
              <div className="text-left">
                <div className="flex items-center gap-1.5 text-xs font-sans font-medium text-pink-300">
                  <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                  <span>Website Triggered!</span>
                </div>
                <p className="text-[10px] text-pink-200/80 mt-1">
                  Lola opened <strong className="text-white">{popupToast.name}</strong>.
                </p>
              </div>
              <a
                id="toast-popup-safelink"
                href={popupToast.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => setPopupToast(null)}
                className="flex items-center gap-1 bg-pink-500 hover:bg-pink-600 text-white font-sans text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 shadow-lg shadow-pink-500/20 transition-all cursor-pointer"
              >
                <span>Reveal Website</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Holographic Radar Canvas Area */}
        <div className="relative w-full aspect-square max-h-72 flex items-center justify-center p-4">
          <AudioVisualizer 
            state={sessionState} 
            analyser={sessionState === SessionState.SPEAKING ? lolaAnalyser : userAnalyser}
          />

          {/* Small Status Glow Overlay */}
          <div className="absolute bottom-4 bg-slate-900/60 backdrop-blur-md px-4 py-1.5 rounded-full border border-pink-500/10 text-[11px] text-slate-300 font-sans tracking-wide">
            {sessionState === SessionState.DISCONNECTED && "Assistant Offline"}
            {sessionState === SessionState.CONNECTING && "Establishing Vibe Connection..."}
            {sessionState === SessionState.LISTENING && "Speak now, babe..."}
            {sessionState === SessionState.SPEAKING && "Lola is talking..."}
          </div>
        </div>

        {/* Captions Overlay Screen */}
        <div className="w-full h-24 mb-3 px-4 flex items-center justify-center relative select-none">
          <AnimatePresence mode="wait">
            {sessionState === SessionState.DISCONNECTED ? (
              <motion.div
                key="dc"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-slate-500 text-center max-w-xs font-sans leading-relaxed text-xs"
              >
                <p>No audio streaming. Lola is currently asleep in her cyber lounge.</p>
                <p className="text-[10px] mt-1 text-slate-600">Tap the power button below to awaken her.</p>
              </motion.div>
            ) : sessionState === SessionState.CONNECTING ? (
              <motion.div
                key="conn"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <RefreshCw className="w-5 h-5 text-pink-500 animate-spin" />
                <span className="text-pink-400 font-sans italic text-xs font-medium animate-pulse">
                  "{connectingPrompt}"
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="live"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full text-center max-w-[420px] px-2 flex flex-col justify-center h-full"
              >
                {captions ? (
                  <p className="text-pink-150 font-sans text-sm md:text-base font-medium leading-relaxed drop-shadow-[0_2px_10px_rgba(244,63,94,0.15)] bg-linear-to-r from-pink-200 to-indigo-100 bg-clip-text text-transparent">
                    {captions}
                  </p>
                ) : (
                  <p className="text-slate-500 font-sans italic text-xs">
                    "{idlePrompt}"
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Futuristic Mic / Power Trigger Ring Controls */}
        <div className="relative flex flex-col items-center gap-3">
          
          {/* Pulsing ring aura */}
          <div className="absolute -inset-4 rounded-full pointer-events-none flex items-center justify-center">
            {sessionState !== SessionState.DISCONNECTED && (
              <motion.div
                animate={{
                  scale: [1, 1.25, 1],
                  opacity: [0.15, 0, 0.15]
                }}
                transition={{
                  duration: 2.2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="w-24 h-24 rounded-full border border-pink-500 absolute"
              />
            )}
          </div>

          <motion.button
            id="lola-mic-toggle-btn"
            whileTap={{ scale: 0.94 }}
            onClick={sessionState === SessionState.DISCONNECTED ? connectSession : disconnectSession}
            className={`w-18 h-18 rounded-full flex items-center justify-center shadow-2xl relative cursor-pointer outline-hidden transition-all duration-300 border ${
              sessionState !== SessionState.DISCONNECTED
                ? "bg-pink-500 text-white shadow-pink-500/30 border-pink-400 hover:bg-pink-600"
                : "bg-slate-900 text-slate-400 hover:text-pink-400 shadow-black border-slate-800/80 hover:bg-slate-800/60"
            }`}
          >
            {sessionState === SessionState.DISCONNECTED ? (
              <Power className="w-7 h-7" />
            ) : (
              <Mic className="w-7 h-7 animate-pulse" />
            )}
          </motion.button>

          <span className="font-sans font-semibold tracking-wider text-[11px] text-slate-500 uppercase">
            {sessionState === SessionState.DISCONNECTED ? "Tap to wake Lola" : "STREAMING ACTIVE • TAP TO SLEEP"}
          </span>
        </div>

        {/* Human memory/collapsible panel */}
        <HistoryTray 
          logs={logs} 
          toolsActivated={toolsActivated} 
          onClearLogs={handleClearHub}
        />

        {/* Small Environmental Note */}
        <div className="flex items-center gap-1.5 opacity-50 mt-6 text-slate-500 text-[10px]">
          <Info className="w-3 h-3 text-slate-500" />
          <span>Continuous session with responsive local interruptions.</span>
        </div>

      </main>
    </div>
  );
}
