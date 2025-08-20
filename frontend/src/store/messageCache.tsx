import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Run, Message } from '../components/types/datamodel';
import { checkAndCleanStorage } from '../utils/storageUtils';

// 在模块加载时检查存储使用情况
checkAndCleanStorage();

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

// 辅助函数：清理消息内容以减少存储大小
const cleanMessageForStorage = (message: Message): Message => {
  const cleanedMessage = { ...message };

  // 如果消息内容过长，截断保留前1000字符
  if (typeof cleanedMessage.config.content === 'string' && cleanedMessage.config.content.length > 1000) {
    cleanedMessage.config.content = cleanedMessage.config.content.substring(0, 1000) + '...[truncated]';
  }

  // 清理不必要的metadata
  if (cleanedMessage.config.metadata) {
    const { attached_files, ...essentialMetadata } = cleanedMessage.config.metadata;
    cleanedMessage.config.metadata = essentialMetadata;
  }

  return cleanedMessage;
};

// 辅助函数：清理Run对象以减少存储大小
const cleanRunForStorage = (run: Run): Run => {
  const cleanedRun = { ...run };

  console.log('Cleaning run for storage:', cleanedRun);

  // 只保留最近50条消息
  if (cleanedRun.messages.length > 50) {
    cleanedRun.messages = cleanedRun.messages.slice(-50);
  }

  // 清理每条消息
  cleanedRun.messages = cleanedRun.messages.map(cleanMessageForStorage);

  return cleanedRun;
};

export const useMessageCacheStore = create<MessageCacheState>()(
  persist(
    (set, get) => ({
      sessionRuns: {},

      setSessionRun: (sessionId: number, run: Run) => {
        try {
          const cleanedRun = cleanRunForStorage(run);
          set((state) => {
            // 限制缓存的会话数量，只保留最近的5个会话
            const sessionIds = Object.keys(state.sessionRuns).map(Number);
            const newSessionRuns = { ...state.sessionRuns };

            if (sessionIds.length >= 5 && !newSessionRuns[sessionId]) {
              // 删除最旧的会话
              const oldestSessionId = Math.min(...sessionIds);
              delete newSessionRuns[oldestSessionId];
            }

            return {
              sessionRuns: {
                ...newSessionRuns,
                [sessionId]: cleanedRun,
              },
            };
          });
        } catch (error) {
          console.warn('Failed to cache session run, clearing cache:', error);
          // 如果存储失败，清除缓存
          set({ sessionRuns: {} });
        }
      },

      getSessionRun: (sessionId: number) => {
        const state = get();
        return state.sessionRuns[sessionId] || null;
      },

      updateSessionMessages: (sessionId: number, messages: Message[]) => {
        try {
          set((state) => {
            const existingRun = state.sessionRuns[sessionId];
            if (!existingRun) return state;

            // 限制消息数量并清理
            const cleanedMessages = messages.slice(-50).map(cleanMessageForStorage);

            return {
              sessionRuns: {
                ...state.sessionRuns,
                [sessionId]: {
                  ...existingRun,
                  messages: cleanedMessages,
                },
              },
            };
          });
        } catch (error) {
          console.warn('Failed to update session messages:', error);
        }
      },

      addMessageToSession: (sessionId: number, message: Message) => {
        try {
          set((state) => {
            const existingRun = state.sessionRuns[sessionId];
            if (!existingRun) return state;

            const cleanedMessage = cleanMessageForStorage(message);
            let updatedMessages = [...existingRun.messages, cleanedMessage];

            // 限制消息数量
            if (updatedMessages.length > 50) {
              updatedMessages = updatedMessages.slice(-50);
            }

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
        } catch (error) {
          console.warn('Failed to add message to session:', error);
        }
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
          Object.entries(state.sessionRuns)
            .slice(-3) // 只保留最近3个会话的缓存
            .map(([sessionId, run]) => [sessionId, cleanRunForStorage(run)])
        ),
      }),
      // 添加存储错误处理
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('Failed to rehydrate message cache:', error);
          // 清除损坏的缓存
          localStorage.removeItem('drsai-message-cache');
        }
      },
    }
  )
);
