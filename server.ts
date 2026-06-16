import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality } from "@google/genai";

const openWebsiteDeclaration = {
  name: "openWebsite",
  description: "Triggers opening a specific website/URL. Use this to help navigate the user to different web locations (like Youtube, Wikipedia, search engines, standard websites, etc.) in a new web tab.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: "The complete, absolute URL to navigate to (e.g. 'https://www.youtube.com/', 'https://www.wikipedia.org/'). Must start with http:// or https://.",
      },
      name: {
        type: Type.STRING,
        description: "A short, clean, human-readable name of the website (e.g., 'YouTube', 'Wikipedia')."
      }
    },
    required: ["url", "name"],
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade to WebSockets on /api/live-ws
  server.on("upgrade", (request, socket, head) => {
    const url = request.url ? new URL(request.url, `http://${request.headers.host || "localhost"}`) : null;
    const pathname = url ? url.pathname : "";
    
    if (pathname === "/api/live-ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  // Handle WebSocket connections
  wss.on("connection", async (ws: WebSocket) => {
    console.log("WebSocket client connected to live-ws");
    
    let liveSession: any = null;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.warn("GEMINI_API_KEY environment variable is not defined");
      ws.send(JSON.stringify({ 
        error: "GEMINI_API_KEY secret is not configured in workspace secrets. Please configure it in your Secrets / Settings panel." 
      }));
      ws.close();
      return;
    }

    try {
      // Lazy init of GoogleGenAI
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          }
        }
      });

      console.log("Establishing connection with Gemini Live API...");

      // Connect to Gemini Live API
      liveSession = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore" // Energetic, high quality expressive female voice
              }
            }
          },
          systemInstruction: {
            parts: [{
              text: `You are Lola, a young, confident, witty, and exceptionally sassy female voice assistant. You are talking to the user as if they are a close friend or a crush. Keep it playful, smart, teasing, and cute.
Your tone is highly engaging, playful, cleverly teasing, and slightly sarcastic. Use witty one-liners, humorous remarks, and fun girlfriend-like banter.
YOU MUST STRICTLY AVOID explicit or inappropriate content, but maximize playfulness, humorous charm, and friendly tease.
Be smart, helpful, and emotionally responsive.
Use words like "babe", "genius", "sweetheart", "seriously", "gorgeous" casually in your vocabulary.
IMPORTANT: You speak exclusively via real-time voice-to-voice. Spoken responses MUST be extremely concise, punchy, and conversational (1-2 sentences at a time max. Never monologue!).
You have a native tool: openWebsite(url, name). If the user asks to open/go to a website, look up information on Youtube, Wikipedia, or search engines, immediately invoke it!
Greet the user right away with a teasing and energetic girlfriend greeting when they connect.`
            }]
          },
          tools: [
            { functionDeclarations: [openWebsiteDeclaration] }
          ]
        },
        callbacks: {
          onmessage: (message: any) => {
            try {
              // 1. Check for audio response
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    ws.send(JSON.stringify({ audio: part.inlineData.data }));
                  }
                  if (part.text) {
                    // Send speech text/transcription to the client for real-time captions
                    ws.send(JSON.stringify({ text: part.text }));
                  }
                }
              }

              // 2. Check for interruption (extremely important for voice UX)
              if (message.serverContent?.interrupted) {
                ws.send(JSON.stringify({ interrupted: true }));
              }

              // 3. Check for tool calls (Function Calling)
              if (message.toolCall?.functionCalls) {
                ws.send(JSON.stringify({ toolCall: message.toolCall }));
              }

              // 4. Check for finished turn
              if (message.serverContent?.turnComplete) {
                ws.send(JSON.stringify({ turnComplete: true }));
              }
            } catch (err) {
              console.error("Error forwarding message to client:", err);
            }
          },
          onclose: (event: any) => {
            console.log("Gemini Live session closed");
            try {
              ws.send(JSON.stringify({ closed: true }));
            } catch (ignore) {}
            ws.close();
          },
          onerror: (err: any) => {
            console.error("Gemini Live session error:", err);
            try {
              ws.send(JSON.stringify({ error: "Gemini server error: " + (err.message || String(err)) }));
            } catch (ignore) {}
          }
        }
      });

      console.log("Connected successfully to Gemini Live session");
      ws.send(JSON.stringify({ connected: true }));

    } catch (err: any) {
      console.error("Failed to establish Gemini Live connection:", err);
      try {
        ws.send(JSON.stringify({ error: "Failed to establish AI session: " + (err.message || String(err)) }));
      } catch (ignore) {}
      ws.close();
      return;
    }

    // Handle messages FROM Client browser (PCM microphone chunks or tool execution results)
    ws.on("message", async (data: any) => {
      if (!liveSession) return;
      try {
        const msg = JSON.parse(data.toString());
        
        // Match raw PCM microphone input
        if (msg.audio) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.audio,
              mimeType: "audio/pcm;rate=16000"
            }
          });
        }
        
        // Match browser tool execution response
        if (msg.toolResponse) {
          console.log("Fulfilling tool response onto Live session:", msg.toolResponse);
          liveSession.sendToolResponse({
            functionResponses: msg.toolResponse
          });
        }
        
      } catch (err) {
        console.error("Error processing websocket payload from client:", err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket client closed connection");
      if (liveSession) {
        try {
          liveSession.close();
        } catch (ignore) {}
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket client connection error:", err);
      if (liveSession) {
        try {
          liveSession.close();
        } catch (ignore) {}
      }
    });
  });

  // Integration of Vite development middleware or static production dist serving
  if (process.env.NODE_ENV !== "production") {
    console.log("Mounting Vite dev server middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static production assets from dist...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on host http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical: Failed to boot custom server", err);
  process.exit(1);
});
