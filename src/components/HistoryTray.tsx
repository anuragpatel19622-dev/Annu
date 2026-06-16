import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Globe, 
  Terminal, 
  ChevronUp, 
  ChevronDown, 
  ExternalLink, 
  Sparkles, 
  Clock 
} from "lucide-react";
import { ToolCallData, AssistantLog } from "../types";

interface HistoryTrayProps {
  logs: AssistantLog[];
  toolsActivated: ToolCallData[];
  onClearLogs: () => void;
}

export default function HistoryTray({ logs, toolsActivated, onClearLogs }: HistoryTrayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"actions" | "logs">("actions");

  return (
    <div className="w-full max-w-lg mx-auto bg-slate-900/80 backdrop-blur-md rounded-2xl border border-pink-500/10 shadow-2xl overflow-hidden mt-6">
      {/* Header Button */}
      <button
        id="history-tray-toggle"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-800/40 transition-colors duration-200"
      >
        <div className="flex items-center gap-2.5 text-pink-400 font-sans font-medium text-sm">
          <Terminal className="w-4 h-4 animate-pulse" />
          <span className="tracking-wide">Lola's Action & Memory Hub</span>
          {toolsActivated.length > 0 && (
            <span className="bg-pink-500/20 text-pink-300 text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border border-pink-500/30">
              {toolsActivated.length}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {/* Expandable Panel */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 260 }}
            exit={{ height: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="border-t border-slate-800 flex flex-col"
          >
            {/* Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-950/40 px-3 text-xs">
              <button
                id="hub-tab-actions"
                onClick={() => setActiveTab("actions")}
                className={`px-4 py-2.5 font-sans font-medium transition-all relative ${
                  activeTab === "actions" ? "text-pink-400" : "text-slate-400 hover:text-slate-300"
                }`}
              >
                <span>Actions Executed</span>
                {activeTab === "actions" && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500"
                  />
                )}
              </button>
              <button
                id="hub-tab-logs"
                onClick={() => setActiveTab("logs")}
                className={`px-4 py-2.5 font-sans font-medium transition-all relative ${
                  activeTab === "logs" ? "text-pink-400" : "text-slate-400 hover:text-slate-300"
                }`}
              >
                <span>Sassy Event Logs</span>
                {activeTab === "logs" && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500"
                  />
                )}
              </button>

              <button
                id="hub-clear-logs"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearLogs();
                }}
                className="ml-auto text-[10px] text-slate-500 hover:text-rose-400 font-mono self-center px-2 py-1 rounded hover:bg-rose-500/10 transition-colors"
              >
                Reset Hub
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-slate-300 scrollbar-thin">
              {activeTab === "actions" ? (
                <div className="space-y-2.5">
                  {toolsActivated.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500">
                      <Globe className="w-8 h-8 text-slate-600 mb-2 stroke-[1.5]" />
                      <p className="font-sans text-xs">No websites opened yet.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Ask Lola to check out Wikipedia or YouTube!</p>
                    </div>
                  ) : (
                    toolsActivated.map((item) => (
                      <div
                        id={`action-item-${item.id}`}
                        key={item.id}
                        className="bg-slate-950/60 p-3 rounded-lg border border-pink-500/5 hover:border-pink-500/20 transition-all flex items-center justify-between"
                      >
                        <div className="space-y-0.5 text-left">
                          <div className="flex items-center gap-1.5 font-sans font-medium text-pink-300 text-xs">
                            <Sparkles className="w-3.5 h-3.5 text-pink-400 animate-pulse" />
                            <span>Lola opened {item.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 break-all">{item.url}</span>
                        </div>
                        
                        <a
                          id={`action-link-${item.id}`}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 hover:text-pink-300 px-2.5 py-1.5 rounded-md font-sans text-[11px] font-medium border border-pink-500/20 transition-all"
                        >
                          <span>Go</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 font-sans text-xs">
                      No events in memory buffer.
                    </div>
                  ) : (
                    logs.slice().reverse().map((log) => (
                      <div
                        id={`log-item-${log.id}`}
                        key={log.id}
                        className="flex gap-2 text-left leading-relaxed text-[11px] border-b border-slate-800/20 pb-1"
                      >
                        <span className="text-slate-500 flex items-center gap-0.5 whitespace-nowrap shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        
                        {log.type === "error" ? (
                          <span className="text-rose-400 font-semibold">[System Blocked]</span>
                        ) : log.type === "tool" ? (
                          <span className="text-pink-400 font-semibold">[Tool Applied]</span>
                        ) : (
                          <span className="text-indigo-400 font-semibold">[Vibe Update]</span>
                        )}

                        <span className={log.type === "error" ? "text-rose-200" : log.type === "tool" ? "text-pink-200" : "text-slate-300"}>
                          {log.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
