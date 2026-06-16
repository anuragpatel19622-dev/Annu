/**
 * State of the real-time Live AI session
 */
export enum SessionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  IDLE = "idle",       // Connected, ready, but not speaking or listening
  LISTENING = "listening", // Listening to mic input
  SPEAKING = "speaking"    // Currently speaking (playing audio chunks)
}

/**
 * Historical log of interactive events
 */
export interface AssistantLog {
  id: string;
  timestamp: Date;
  type: "status" | "transcription" | "tool" | "error";
  text: string;
}

/**
 * Representation of executed browser tool calls (e.g. openWebsite)
 */
export interface ToolCallData {
  id: string;
  name: string;
  url: string;
  timestamp: Date;
  status: "pending" | "success" | "failed";
}
