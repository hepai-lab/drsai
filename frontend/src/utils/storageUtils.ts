// localStorage管理工具函数

export interface StorageInfo {
  used: number; // 已使用字节数
  usedMB: number; // 已使用MB数
  usagePercent: number; // 使用百分比（基于估算的5MB配额）
  items: { key: string; size: number; sizeMB: number }[]; // 各项目大小
}

/**
 * 获取localStorage使用情况
 */
export const getStorageInfo = (): StorageInfo => {
  // 服务器端返回默认值
  if (typeof window === "undefined") {
    return {
      used: 0,
      usedMB: 0,
      usagePercent: 0,
      items: [],
    };
  }

  const items: { key: string; size: number; sizeMB: number }[] = [];
  let totalUsed = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key) || '';
      const size = new Blob([value]).size;
      totalUsed += size;
      items.push({
        key,
        size,
        sizeMB: size / 1024 / 1024,
      });
    }
  }

  // 按大小排序
  items.sort((a, b) => b.size - a.size);

  const quota = 5 * 1024 * 1024; // 估算5MB配额
  const usagePercent = (totalUsed / quota) * 100;

  return {
    used: totalUsed,
    usedMB: totalUsed / 1024 / 1024,
    usagePercent,
    items,
  };
};

/**
 * 清理DrSai相关的localStorage数据
 */
export const clearDrSaiStorage = (): void => {
  if (typeof window === "undefined") return;
  
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('drsai-') || key.includes('drsai'))) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
  });

  console.log(`Cleared ${keysToRemove.length} DrSai storage items:`, keysToRemove);
};

/**
 * 清理消息缓存
 */
export const clearMessageCache = (): void => {
  if (typeof window === "undefined") return;
  
  localStorage.removeItem('drsai-message-cache');
  console.log('Message cache cleared');
};

/**
 * 检查存储空间并在必要时清理
 */
export const checkAndCleanStorage = (): boolean => {
  if (typeof window === "undefined") return false;
  
  const info = getStorageInfo();
  
  console.log(`localStorage usage: ${info.usedMB.toFixed(2)}MB (${info.usagePercent.toFixed(1)}%)`);
  
  // 如果使用超过80%，清理缓存
  if (info.usagePercent > 80) {
    console.warn('localStorage usage high, clearing message cache');
    clearMessageCache();
    return true;
  }
  
  return false;
};

/**
 * 安全的localStorage设置，带有错误处理
 */
export const safeSetItem = (key: string, value: string): boolean => {
  if (typeof window === "undefined") return false;
  
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to set localStorage item '${key}':`, error);
    
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      // 尝试清理并重试
      const cleaned = checkAndCleanStorage();
      if (cleaned) {
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (retryError) {
          console.error('Failed to set item even after cleanup:', retryError);
        }
      }
    }
    
    return false;
  }
};

/**
 * 获取存储使用情况的人类可读字符串
 */
export const getStorageUsageString = (): string => {
  const info = getStorageInfo();
  return `${info.usedMB.toFixed(2)}MB used (${info.usagePercent.toFixed(1)}%)`;
};

// 在开发环境下，将这些函数暴露到全局对象，方便调试
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).drSaiStorage = {
    getInfo: getStorageInfo,
    clear: clearDrSaiStorage,
    clearMessages: clearMessageCache,
    checkAndClean: checkAndCleanStorage,
    usage: getStorageUsageString,
  };
  
  console.log('DrSai storage utils available at window.drSaiStorage');
}
