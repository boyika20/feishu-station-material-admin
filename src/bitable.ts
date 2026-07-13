import { bitable, type IOpenCellValue, type IRecordValue } from '@lark-base-open/js-sdk';
import { cellToNumber, cellToText } from './cells';

export const TABLE = {
  site: '站点',
  stock: '站库存',
  receipt: '入库流水',
  issue: '出库流水',
  transfer: '调拨申请',
  acl: '人员站点权限',
  audit: '修改记录',
} as const;

export type RecordRow = { id: string; fields: Record<string, unknown> };

type FieldMeta = { id: string; name: string };

const fieldMapCache = new Map<string, Map<string, FieldMeta>>();

async function cachedFieldMap(tableName: string): Promise<Map<string, FieldMeta>> {
  const hit = fieldMapCache.get(tableName);
  if (hit) return hit;
  const table = await bitable.base.getTableByName(tableName);
  const metas = await table.getFieldMetaList();
  const map = new Map<string, FieldMeta>();
  for (const m of metas) map.set(m.name, { id: m.id, name: m.name });
  fieldMapCache.set(tableName, map);
  return map;
}

function mapRecord(rec: IRecordValue & { recordId: string }, idToName: Map<string, string>): RecordRow {
  const fields: Record<string, unknown> = {};
  for (const [fid, val] of Object.entries(rec.fields || {})) {
    const name = idToName.get(fid);
    if (name) fields[name] = val;
  }
  return { id: rec.recordId, fields };
}

export async function listRecordsPaged(tableName: string): Promise<RecordRow[]> {
  const table = await bitable.base.getTableByName(tableName);
  const fmap = await cachedFieldMap(tableName);
  const idToName = new Map<string, string>();
  for (const [name, meta] of fmap) idToName.set(meta.id, name);

  const rows: RecordRow[] = [];
  let pageToken: string | undefined;
  do {
    const page = await table.getRecords({ pageSize: 500, pageToken });
    for (const rec of page.records || []) {
      rows.push(mapRecord(rec as IRecordValue & { recordId: string }, idToName));
    }
    pageToken = page.hasMore ? page.pageToken : undefined;
  } while (pageToken);
  return rows;
}

function buildRecordValue(
  fmap: Map<string, FieldMeta>,
  fields: Record<string, IOpenCellValue>,
): { fields: Record<string, IOpenCellValue> } {
  const out: Record<string, IOpenCellValue> = {};
  for (const [name, val] of Object.entries(fields)) {
    const meta = fmap.get(name);
    if (!meta) continue;
    out[meta.id] = val;
  }
  return { fields: out };
}

function parseRecordId(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'recordId' in result) {
    return String((result as { recordId: string }).recordId);
  }
  if (Array.isArray(result) && result[0]) return String(result[0]);
  return '';
}

type FieldPayload = Record<string, string | number | boolean | string[]>;

export async function addRecord(tableName: string, fields: FieldPayload): Promise<string> {
  const table = await bitable.base.getTableByName(tableName);
  const fmap = await cachedFieldMap(tableName);
  const result = await table.addRecord(buildRecordValue(fmap, fields as Record<string, IOpenCellValue>));
  return parseRecordId(result);
}

export async function setRecordFields(tableName: string, recordId: string, fields: FieldPayload) {
  const table = await bitable.base.getTableByName(tableName);
  const fmap = await cachedFieldMap(tableName);
  await table.setRecord(recordId, buildRecordValue(fmap, fields as Record<string, IOpenCellValue>));
}

/** 过账前重读现存量，避免并发改数导致多扣 */
export async function getStockQty(recordId: string): Promise<{ qty: number; fields: Record<string, unknown> }> {
  const table = await bitable.base.getTableByName(TABLE.stock);
  const fmap = await cachedFieldMap(TABLE.stock);
  const idToName = new Map<string, string>();
  for (const [name, meta] of fmap) idToName.set(meta.id, name);

  const anyTable = table as unknown as {
    getRecordById?: (id: string) => Promise<IRecordValue>;
    getRecord?: (id: string) => Promise<IRecordValue>;
  };
  const raw =
    (await anyTable.getRecordById?.(recordId)) ||
    (await anyTable.getRecord?.(recordId)) ||
    null;
  if (!raw) throw new Error(`无法读取库存行 ${recordId}`);
  const mapped = mapRecord({ ...raw, recordId } as IRecordValue & { recordId: string }, idToName);
  return { qty: cellToNumber(mapped.fields['现存量']), fields: mapped.fields };
}

export type IssueLineInput = {
  stockRecordId: string;
  /** 点选时看到的账面，过账时会与重读值比对 */
  expectedQty: number;
  qty: number;
  name: string;
  spec: string;
  category: string;
  unit: string;
  stationCode: string;
  loc: string;
  materialCode: string;
  balanceKey: string;
};

export type IssuePostResult = {
  ok: boolean;
  issueNo: string;
  issueId: string;
  stockRecordId: string;
  name: string;
  qty: number;
  before: number;
  after: number;
  error?: string;
};

/**
 * 领用/消耗过账（单行）：先写出库流水，再扣现存量，再写修改记录。
 * 数量规则：qty>0、≤重读现存量；若重读现存量 ≠ expectedQty 则拒绝（防并发）。
 */
export async function postOneIssue(input: {
  line: IssueLineInput;
  issueType: string;
  recipient: string;
  remark: string;
  operator: string;
}): Promise<IssuePostResult> {
  const { line, issueType, recipient, remark, operator } = input;
  const issueNo = `CK-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

  if (!(line.qty > 0) || !Number.isFinite(line.qty)) {
    return {
      ok: false,
      issueNo,
      issueId: '',
      stockRecordId: line.stockRecordId,
      name: line.name,
      qty: line.qty,
      before: line.expectedQty,
      after: line.expectedQty,
      error: '领用数量必须大于 0',
    };
  }

  let liveQty: number;
  try {
    const live = await getStockQty(line.stockRecordId);
    liveQty = live.qty;
  } catch (e) {
    return {
      ok: false,
      issueNo,
      issueId: '',
      stockRecordId: line.stockRecordId,
      name: line.name,
      qty: line.qty,
      before: line.expectedQty,
      after: line.expectedQty,
      error: String(e),
    };
  }

  if (Math.abs(liveQty - line.expectedQty) > 0.0001) {
    return {
      ok: false,
      issueNo,
      issueId: '',
      stockRecordId: line.stockRecordId,
      name: line.name,
      qty: line.qty,
      before: liveQty,
      after: liveQty,
      error: `账面已变（选时 ${line.expectedQty}，现 ${liveQty}），请刷新后重试`,
    };
  }
  if (line.qty > liveQty + 0.0001) {
    return {
      ok: false,
      issueNo,
      issueId: '',
      stockRecordId: line.stockRecordId,
      name: line.name,
      qty: line.qty,
      before: liveQty,
      after: liveQty,
      error: `领用 ${line.qty} 超过现存量 ${liveQty}`,
    };
  }

  const after = Math.round((liveQty - line.qty) * 100) / 100;
  const now = Date.now();
  let issueId = '';

  try {
    issueId = await addRecord(TABLE.issue, {
      流水号: issueNo,
      站点编码: line.stationCode,
      物资分类: line.category || '耗材',
      物资名称: line.name,
      规格型号: line.spec,
      计量单位: line.unit || 'EA',
      存放地点: line.loc,
      物料编码: line.materialCode,
      数量: line.qty,
      出库类型: issueType || '消耗',
      业务日期: now,
      领用人: recipient || operator || '插件',
      备注: remark || `插件领用过账 ${issueNo}`,
      台账行: [line.stockRecordId],
    });
  } catch (e) {
    return {
      ok: false,
      issueNo,
      issueId: '',
      stockRecordId: line.stockRecordId,
      name: line.name,
      qty: line.qty,
      before: liveQty,
      after: liveQty,
      error: `写出库流水失败: ${e}`,
    };
  }

  try {
    await setRecordFields(TABLE.stock, line.stockRecordId, {
      现存量: after,
      最近变动日: now,
    });
  } catch (e) {
    return {
      ok: false,
      issueNo,
      issueId,
      stockRecordId: line.stockRecordId,
      name: line.name,
      qty: line.qty,
      before: liveQty,
      after: liveQty,
      error: `流水 ${issueNo} 已建，但扣库存失败，请人工核对: ${e}`,
    };
  }

  try {
    await addRecord(TABLE.audit, {
      记录号: `AU-${issueNo}`,
      操作类型: '出库',
      站点编码: line.stationCode,
      结存键: line.balanceKey || `${line.stationCode}|${line.loc}|${line.name}`,
      字段名: '现存量',
      旧值: String(liveQty),
      新值: String(after),
      操作人: operator || recipient || '插件',
      操作时间: now,
      备注: `${issueType} ${line.qty} · ${issueNo}`,
    });
  } catch {
    /* 审计失败不回滚已成功过账 */
  }

  return {
    ok: true,
    issueNo,
    issueId,
    stockRecordId: line.stockRecordId,
    name: line.name,
    qty: line.qty,
    before: liveQty,
    after,
  };
}

/** 按顺序过账多行；任一行失败则停止后续（已成功行不回滚） */
export async function postIssueBatch(input: {
  lines: IssueLineInput[];
  issueType: string;
  recipient: string;
  remark: string;
  operator: string;
}): Promise<IssuePostResult[]> {
  const results: IssuePostResult[] = [];
  for (const line of input.lines) {
    const r = await postOneIssue({
      line,
      issueType: input.issueType,
      recipient: input.recipient,
      remark: input.remark,
      operator: input.operator,
    });
    results.push(r);
    if (!r.ok) break;
  }
  return results;
}

export async function navigateToTable(tableName: string): Promise<void> {
  try {
    const table = await bitable.base.getTableByName(tableName);
    // SDK 在私有化环境能力不一，失败时忽略
    const anyUi = bitable as unknown as { ui?: { switchToTable?: (id: string) => Promise<void> } };
    if (anyUi.ui?.switchToTable) await anyUi.ui.switchToTable(table.id);
  } catch {
    /* ignore */
  }
}

/** 读取当前视图行首勾选（须先打开「站库存」并勾选，对齐物资助手） */
export async function readTableCheckboxSelection(tableName: string): Promise<string[]> {
  try {
    const table = await bitable.base.getTableByName(tableName);
    const sel = await bitable.base.getSelection();
    if (sel.tableId !== table.id) return [];
    const view = sel.viewId ? await table.getViewById(sel.viewId) : await table.getActiveView();
    const grid = view as { getSelectedRecordIdList?: () => Promise<string[]> };
    if (typeof grid.getSelectedRecordIdList !== 'function') return [];
    const ids = await grid.getSelectedRecordIdList();
    return (ids || []).filter(Boolean);
  } catch {
    return [];
  }
}

export type OverviewStats = {
  siteCount: number;
  stockLines: number;
  totalQty: number;
  categoryCount: Record<string, number>;
  stationQty: Array<{ code: string; name: string; lines: number; qty: number }>;
  pendingTransfers: number;
  recentAudits: number;
};

export async function loadOverview(): Promise<OverviewStats> {
  const [sites, stock, transfers, audits] = await Promise.all([
    listRecordsPaged(TABLE.site),
    listRecordsPaged(TABLE.stock),
    listRecordsPaged(TABLE.transfer),
    listRecordsPaged(TABLE.audit),
  ]);

  const siteName = new Map<string, string>();
  for (const s of sites) {
    const code = cellToText(s.fields['站点编码']);
    if (code) siteName.set(code, cellToText(s.fields['站点名称']) || code);
  }

  const categoryCount: Record<string, number> = {};
  const byStation = new Map<string, { lines: number; qty: number }>();
  let totalQty = 0;
  for (const r of stock) {
    const cat = cellToText(r.fields['物资分类']) || '未分类';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    const code = cellToText(r.fields['站点编码']) || '-';
    const qty = cellToNumber(r.fields['现存量']);
    totalQty += qty;
    const cur = byStation.get(code) || { lines: 0, qty: 0 };
    cur.lines += 1;
    cur.qty += qty;
    byStation.set(code, cur);
  }

  const stationQty = [...byStation.entries()]
    .map(([code, v]) => ({
      code,
      name: siteName.get(code) || code,
      lines: v.lines,
      qty: v.qty,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const pendingTransfers = transfers.filter((t) => {
    const st = cellToText(t.fields['状态']);
    return st && !['已关闭', '已取消', '调入确认'].includes(st);
  }).length;

  return {
    siteCount: sites.length,
    stockLines: stock.length,
    totalQty,
    categoryCount,
    stationQty,
    pendingTransfers,
    recentAudits: audits.length,
  };
}

export type CrossHit = {
  station: string;
  name: string;
  spec: string;
  qty: number;
  loc: string;
  code: string;
  category: string;
};

/** 按名称+规格聚合：哪些站还有货（跨站查货） */
export function buildCrossIndex(stock: RecordRow[]): Map<string, CrossHit[]> {
  const map = new Map<string, CrossHit[]>();
  for (const r of stock) {
    const name = cellToText(r.fields['物资名称']);
    const spec = cellToText(r.fields['规格型号']);
    if (!name) continue;
    const key = `${name}||${spec}`;
    const hit: CrossHit = {
      station: cellToText(r.fields['站点编码']),
      name,
      spec,
      qty: cellToNumber(r.fields['现存量']),
      loc: cellToText(r.fields['存放地点']),
      code: cellToText(r.fields['物料编码']),
      category: cellToText(r.fields['物资分类']),
    };
    const arr = map.get(key) || [];
    arr.push(hit);
    map.set(key, arr);
  }
  return map;
}

export async function createTransferDraft(input: {
  name: string;
  spec: string;
  category: string;
  materialCode: string;
  fromStation: string;
  toStation: string;
  qty: number;
  unit: string;
  applicant: string;
}): Promise<string> {
  const no = `DB-${Date.now()}`;
  return addRecord(TABLE.transfer, {
    调拨单号: no,
    物资名称: input.name,
    规格型号: input.spec,
    物资分类: input.category || '耗材',
    物料编码: input.materialCode,
    调出站点编码: input.fromStation,
    调入站点编码: input.toStation,
    数量: input.qty,
    计量单位: input.unit || 'EA',
    状态: '已申请',
    申请人: input.applicant || '插件',
    备注: '由管理插件发起',
  });
}
