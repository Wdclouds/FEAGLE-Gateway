/**
 * Control Plane v2.0 Facade —— 审批双通道 / Persona & 沙箱 / Cron / 审计
 */
import { db } from './db.js';
import { migrate } from './control/migrations.js';
import { loadPersonas, getPersonaCount } from './control/sandbox.js';
import { loadBlocklist } from './control/sessions.js';
import { listJobs } from './control/scheduler.js';

export { auditFull } from './control/audit.js';
export { migrate, type Persona } from './control/migrations.js';
export {
  loadPersonas,
  CORE_TOOLS,
  ensureChannelSandbox,
  listChannelSandboxes,
  updateChannelSandbox,
  deleteChannelSandbox,
  getMemberProfiles,
  getMemberProfile,
  touchMemberProfile,
  updateMemberProfile,
  formatMemberProfileContext,
  loadChannelPersona,
  getPersona,
  listPersonas,
  type MemberProfile,
  type ChannelSandbox,
  type ChannelSummary,
} from './control/sandbox.js';
export {
  getSession,
  setMode,
  loadBlocklist,
  isBlocked,
  addBlock,
  removeBlock,
  listBlocks,
  setPersona,
  setPendingConfirm,
  setWorkspace,
  toolAllowedForChat,
  taskStart,
  taskEnd,
  getTaskCtx,
  requestApproval,
  hasPendingConfirm,
  resolveApproval,
  recordHazard,
  consumeHazard,
  type GatewayMode,
  type SessionRow,
  type TaskCtx,
  type PendingConfirm,
  type HazardArchive,
} from './control/sessions.js';
export {
  setJobHandler,
  startScheduler,
  nextRun,
  listJobs,
  addJob,
  deleteJob,
  type JobRow,
} from './control/scheduler.js';

export function initControlPlane(): void {
  migrate();
  loadPersonas();
  loadBlocklist();
  const cleared = (db.prepare('UPDATE sessions SET turn_lease = 0 WHERE turn_lease = 1').run().changes ?? 0);
  db.prepare('UPDATE sessions SET pending_confirm_id = NULL WHERE pending_confirm_id IS NOT NULL').run();
  if (cleared) console.log(`[control] 启动自愈：重置 ${cleared} 个孤儿租约`);
  console.log(`[control] personas=${getPersonaCount()} jobs=${listJobs().length}`);
}
