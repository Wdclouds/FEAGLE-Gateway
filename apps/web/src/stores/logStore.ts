import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { SseStream } from '../api/sse';

const MAX_LOG_LINES = 1000;

export interface LogEntry {
  id: number;
  raw: string;
  time: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SYS' | 'OTHER';
  message: string;
}

export const useLogStore = defineStore('log', () => {
  const logs = ref<LogEntry[]>([]);
  const filterLevel = ref<string>('ALL');
  const searchKeyword = ref<string>('');
  const autoScroll = ref<boolean>(true);

  let stream: SseStream<string> | null = null;
  let counter = 0;

  function parseLogLine(raw: string): LogEntry {
    counter++;
    const trimmed = raw.trim();
    let level: LogEntry['level'] = 'OTHER';
    let time = new Date().toLocaleTimeString();

    // Check for level pattern like [INFO], [WARN], [ERROR]
    const upper = trimmed.toUpperCase();
    if (upper.includes('ERROR') || upper.includes('FAIL') || upper.includes('FATAL')) {
      level = 'ERROR';
    } else if (upper.includes('WARN')) {
      level = 'WARN';
    } else if (upper.includes('INFO')) {
      level = 'INFO';
    } else if (upper.includes('DEBUG')) {
      level = 'DEBUG';
    } else if (upper.includes('[SYS]') || upper.includes('[GATEWAY]') || upper.includes('[DASHBOARD]')) {
      level = 'SYS';
    }

    return {
      id: counter,
      raw: trimmed,
      time,
      level,
      message: trimmed,
    };
  }

  function addLog(line: string) {
    if (!line) return;
    const entry = parseLogLine(line);
    logs.value.push(entry);
    if (logs.value.length > MAX_LOG_LINES) {
      logs.value.shift();
    }
  }

  function initLogStream() {
    if (stream) return;
    stream = new SseStream<string>('/logs');
    stream.subscribe((line) => {
      addLog(String(line));
    });
  }

  function clearLogs() {
    logs.value = [];
  }

  const filteredLogs = computed(() => {
    let result = logs.value;
    if (filterLevel.value !== 'ALL') {
      result = result.filter((l) => l.level === filterLevel.value);
    }
    if (searchKeyword.value.trim()) {
      const q = searchKeyword.value.trim().toLowerCase();
      result = result.filter((l) => l.raw.toLowerCase().includes(q));
    }
    return result;
  });

  return {
    logs,
    filteredLogs,
    filterLevel,
    searchKeyword,
    autoScroll,
    initLogStream,
    clearLogs,
    addLog,
  };
});
