import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Run, Message } from '../components/types/datamodel';

interface MessageCacheState {
  // 缓存每个会话的运行数据
  sessionRuns: { [sessionId: number]: Run };
  
  // 设置会话的运行数据
  setSessionRun: (sessionId: number, run: Run) => void;
  
  // 获取会话的运行数据
  getSessionRun: (sessionId: number) => Run | null;
  
  // 更新会话的消息
  updateSessionMessages: (sessionId: number, messages: Message[]) => void;
  
  // 添加单个消息到会话
  addMessageToSession: (sessionId: number, message: Message) => void;
  
  // 更新会话中的特定消息
  updateMessageInSession: (sessionId: number, messageIndex: number, message: Message) => void;
  
  // 清除特定会话的缓存
  clearSessionCache: (sessionId: number) => void;
  
  // 清除所有缓存
  clearAllCache: () => void;
}

export const useMessageCacheStore = create<MessageCacheState>()(
  persist(
    (set, get) => ({
      sessionRuns: {},
      
      setSessionRun: (sessionId: number, run: Run) => {
        set((state) => ({
          sessionRuns: {
            ...state.sessionRuns,
            [sessionId]: run,
          },
        }));
      },
      
      getSessionRun: (sessionId: number) => {
        const state = get();
        return state.sessionRuns[sessionId] || null;
      },
      
      updateSessionMessages: (sessionId: number, messages: Message[]) => {
        set((state) => {
          const existingRun = state.sessionRuns[sessionId];
          if (!existingRun) return state;
          
          return {
            sessionRuns: {
              ...state.sessionRuns,
              [sessionId]: {
                ...existingRun,
                messages,
              },
            },
          };
        });
      },
      
      addMessageToSession: (sessionId: number, message: Message) => {
        set((state) => {
          const existingRun = state.sessionRuns[sessionId];
          if (!existingRun) return state;
          
          return {
            sessionRuns: {
              ...state.sessionRuns,
              [sessionId]: {
                ...existingRun,
                messages: [...existingRun.messages, message],
              },
            },
          };
        });
      },
      
      updateMessageInSession: (sessionId: number, messageIndex: number, message: Message) => {
        set((state) => {
          const existingRun = state.sessionRuns[sessionId];
          if (!existingRun || messageIndex >= existingRun.messages.length) return state;
          
          const updatedMessages = [...existingRun.messages];
          updatedMessages[messageIndex] = message;
          
          return {
            sessionRuns: {
              ...state.sessionRuns,
              [sessionId]: {
                ...existingRun,
                messages: updatedMessages,
              },
            },
          };
        });
      },
      
      clearSessionCache: (sessionId: number) => {
        set((state) => {
          const newSessionRuns = { ...state.sessionRuns };
          delete newSessionRuns[sessionId];
          return { sessionRuns: newSessionRuns };
        });
      },
      
      clearAllCache: () => {
        set({ sessionRuns: {} });
      },
    }),
    {
      name: 'drsai-message-cache',
      // 只持久化必要的数据，避免存储过大
      partialize: (state) => ({
        sessionRuns: Object.fromEntries(
          Object.entries(state.sessionRuns).slice(-10) // 只保留最近10个会话的缓存
        ),
      }),
    }
  )
);
