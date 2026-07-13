import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TABLE,
  buildCrossIndex,
  createTransferDraft,
  listRecordsPaged,
  loadOverview,
  navigateToTable,
  postIssueBatch,
  readTableCheckboxSelection,
  type CrossHit,
  type IssueLineInput,
  type OverviewStats,
  type RecordRow,
} from './bitable';
import { cellToNumber, cellToText, truncateText } from './cells';
import { PLUGIN_BUILD_LABEL } from './version';

type Tab = 'overview' | 'stock' | 'issue' | 'find' | 'transfer' | 'audit' | 'acl';

type CartLine = IssueLineInput & { key: string };

const TABS: Array<[Tab, string]> = [
  ['overview', '总览'],
  ['stock', '库存'],
  ['issue', '批量领用'],
  ['find', '跨站查货'],
  ['transfer', '调拨'],
  ['audit', '审计'],
  ['acl', '权限'],
];

const ISSUE_TYPES = ['消耗', '领用', '报废', '盘亏', '其他'] as const;

function stockToCartLine(r: RecordRow, qty = 1): CartLine {
  const stationCode = cellToText(r.fields['站点编码']);
  const loc = cellToText(r.fields['存放地点']);
  const name = cellToText(r.fields['物资名称']);
  const expectedQty = cellToNumber(r.fields['现存量']);
  return {
    key: r.id,
    stockRecordId: r.id,
    expectedQty,
    qty: Math.min(Math.max(qty, 0.01), expectedQty || qty),
    name,
    spec: cellToText(r.fields['规格型号']),
    category: cellToText(r.fields['物资分类']) || '耗材',
    unit: cellToText(r.fields['计量单位']) || 'EA',
    stationCode,
    loc,
    materialCode: cellToText(r.fields['物料编码']),
    balanceKey: cellToText(r.fields['结存键']) || `${stationCode}|${loc}|${name}`,
  };
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [stock, setStock] = useState<RecordRow[]>([]);
  const [transfers, setTransfers] = useState<RecordRow[]>([]);
  const [audits, setAudits] = useState<RecordRow[]>([]);
  const [acl, setAcl] = useState<RecordRow[]>([]);
  const [sites, setSites] = useState<RecordRow[]>([]);

  const [stationFilter, setStationFilter] = useState('');
  const [q, setQ] = useState('');
  const [findQ, setFindQ] = useState('');

  const [tfName, setTfName] = useState('');
  const [tfSpec, setTfSpec] = useState('');
  const [tfCat, setTfCat] = useState('工器具');
  const [tfCode, setTfCode] = useState('');
  const [tfFrom, setTfFrom] = useState('');
  const [tfTo, setTfTo] = useState('');
  const [tfQty, setTfQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [issueType, setIssueType] = useState<string>('消耗');
  const [recipient, setRecipient] = useState('');
  const [issueRemark, setIssueRemark] = useState('');
  const [confirmPost, setConfirmPost] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [ov, st, tr, au, ac, si] = await Promise.all([
        loadOverview(),
        listRecordsPaged(TABLE.stock),
        listRecordsPaged(TABLE.transfer),
        listRecordsPaged(TABLE.audit),
        listRecordsPaged(TABLE.acl),
        listRecordsPaged(TABLE.site),
      ]);
      setStats(ov);
      setStock(st);
      setTransfers(tr);
      setAudits(au);
      setAcl(ac);
      setSites(si);
      setMsg(null);
    } catch (e) {
      setMsg({ type: 'err', text: String(e) });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stationOptions = useMemo(() => {
    return sites
      .map((s) => ({
        code: cellToText(s.fields['站点编码']),
        name: cellToText(s.fields['站点名称']),
      }))
      .filter((s) => s.code)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [sites]);

  const filteredStock = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return stock.filter((r) => {
      if (stationFilter && cellToText(r.fields['站点编码']) !== stationFilter) return false;
      if (!qq) return true;
      const blob = [
        cellToText(r.fields['物资名称']),
        cellToText(r.fields['规格型号']),
        cellToText(r.fields['物料编码']),
        cellToText(r.fields['存放地点']),
        cellToText(r.fields['物资分类']),
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(qq);
    });
  }, [stock, stationFilter, q]);

  const crossIndex = useMemo(() => buildCrossIndex(stock), [stock]);

  const findHits = useMemo(() => {
    const qq = findQ.trim().toLowerCase();
    if (!qq) return [] as Array<{ key: string; hits: CrossHit[] }>;
    const out: Array<{ key: string; hits: CrossHit[] }> = [];
    for (const [key, hits] of crossIndex) {
      if (key.toLowerCase().includes(qq) || hits.some((h) => h.code.toLowerCase().includes(qq))) {
        const withQty = hits.filter((h) => h.qty > 0);
        if (withQty.length) out.push({ key, hits: withQty });
      }
    }
    return out.slice(0, 40);
  }, [crossIndex, findQ]);

  const submitTransfer = async () => {
    setBusy(true);
    try {
      const id = await createTransferDraft({
        name: tfName.trim(),
        spec: tfSpec.trim(),
        category: tfCat,
        materialCode: tfCode.trim(),
        fromStation: tfFrom,
        toStation: tfTo,
        qty: Number(tfQty) || 0,
        unit: 'EA',
        applicant: '管理插件',
      });
      setMsg({ type: 'ok', text: `已创建调拨申请 ${id || ''}`.trim() });
      setTfName('');
      setTfSpec('');
      setTfCode('');
      setTfQty('1');
      await refresh(true);
      setTab('transfer');
    } catch (e) {
      setMsg({ type: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fillTransferFromHit = (h: CrossHit, toStation: string) => {
    setTfName(h.name);
    setTfSpec(h.spec);
    setTfCat(h.category || '工器具');
    setTfCode(h.code);
    setTfFrom(h.station);
    setTfTo(toStation);
    setTfQty(String(Math.min(1, h.qty) || 1));
    setTab('transfer');
  };

  const loadSelectionIntoCart = async () => {
    setBusy(true);
    try {
      await navigateToTable(TABLE.stock);
      const ids = await readTableCheckboxSelection(TABLE.stock);
      if (!ids.length) {
        setMsg({
          type: 'err',
          text: '未读到勾选。请先打开「站库存」表勾选多行，再点「读取勾选」（对齐物资助手验收）',
        });
        return;
      }
      const map = new Map(stock.map((r) => [r.id, r]));
      const next: CartLine[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const r = map.get(id);
        if (!r) {
          missing.push(id.slice(-6));
          continue;
        }
        const line = stockToCartLine(r, 1);
        if (line.expectedQty > 0) next.push(line);
      }
      if (!next.length) {
        setMsg({ type: 'err', text: '勾选行现存量均为 0 或未在缓存中，请点刷新后再试' });
        return;
      }
      setCart(next);
      setConfirmPost(false);
      setTab('issue');
      setMsg({
        type: 'ok',
        text: `已读入 ${next.length} 行${missing.length ? `（跳过 ${missing.length}）` : ''}`,
      });
    } catch (e) {
      setMsg({ type: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const updateCartQty = (key: string, raw: string) => {
    const n = parseFloat(raw);
    setCart((prev) =>
      prev.map((x) => {
        if (x.key !== key) return x;
        if (!Number.isFinite(n) || n <= 0) return { ...x, qty: 0 };
        return { ...x, qty: Math.round(n * 100) / 100 };
      }),
    );
    setConfirmPost(false);
  };

  const removeCartLine = (key: string) => {
    setCart((prev) => prev.filter((x) => x.key !== key));
    setConfirmPost(false);
  };

  const cartErrors = useMemo(() => {
    const errs: string[] = [];
    if (!cart.length) errs.push('清单为空');
    for (const x of cart) {
      if (!(x.qty > 0)) errs.push(`${x.name}：数量须大于 0`);
      else if (x.qty > x.expectedQty + 0.0001) errs.push(`${x.name}：${x.qty} > 账面 ${x.expectedQty}`);
    }
    return errs;
  }, [cart]);

  const submitIssue = async () => {
    if (cartErrors.length) {
      setMsg({ type: 'err', text: cartErrors[0] });
      return;
    }
    if (!confirmPost) {
      setConfirmPost(true);
      setMsg({ type: 'ok', text: '请再次确认数量无误后，点「确认过账」' });
      return;
    }
    setBusy(true);
    try {
      const results = await postIssueBatch({
        lines: cart.map(({ key: _k, ...line }) => line),
        issueType,
        recipient: recipient.trim() || '站员',
        remark: issueRemark.trim(),
        operator: recipient.trim() || '管理插件',
      });
      const ok = results.filter((r) => r.ok);
      const bad = results.find((r) => !r.ok);
      if (bad && !ok.length) {
        setMsg({ type: 'err', text: bad.error || '过账失败' });
      } else if (bad) {
        setMsg({
          type: 'err',
          text: `已成功 ${ok.length} 行，中断于「${bad.name}」：${bad.error}`,
        });
        const doneIds = new Set(ok.map((r) => r.stockRecordId));
        setCart((prev) => prev.filter((x) => !doneIds.has(x.stockRecordId)));
      } else {
        setMsg({
          type: 'ok',
          text: `过账成功 ${ok.length} 行：${ok.map((r) => r.issueNo).join('、')}`,
        });
        setCart([]);
        setIssueRemark('');
        setConfirmPost(false);
      }
      await refresh(true);
    } catch (e) {
      setMsg({ type: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      {loading ? (
        <div className="load-bar">
          <div className="load-bar__inner" />
        </div>
      ) : null}

      <header className="app-header">
        <div className="app-header__row">
          <h1 className="app-header__title">分输站物资</h1>
          <button type="button" className="btn-outline" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        <p className="app-header__sub">单行领用用表格按钮 · 多行用本插件批量</p>
        <p className="app-header__ver">{PLUGIN_BUILD_LABEL}</p>
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {msg ? (
        <div className={`toast ${msg.type}`} onClick={() => setMsg(null)} role="status">
          {msg.text}
        </div>
      ) : null}

      {tab === 'overview' && stats ? (
        <section className="panel">
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi__n">{stats.siteCount}</div>
              <div className="kpi__l">站点</div>
            </div>
            <div className="kpi">
              <div className="kpi__n">{stats.stockLines}</div>
              <div className="kpi__l">库存行</div>
            </div>
            <div className="kpi">
              <div className="kpi__n">{Math.round(stats.totalQty)}</div>
              <div className="kpi__l">账面合计</div>
            </div>
            <div className="kpi">
              <div className="kpi__n">{stats.pendingTransfers}</div>
              <div className="kpi__l">进行中调拨</div>
            </div>
          </div>

          <h3 className="sec-title">分类分布</h3>
          <ul className="simple-list">
            {Object.entries(stats.categoryCount).map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </li>
            ))}
          </ul>

          <h3 className="sec-title">各站库存</h3>
          <ul className="simple-list">
            {stats.stationQty.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    setStationFilter(s.code);
                    setTab('stock');
                  }}
                >
                  {s.name} ({s.code})
                </button>
                <span className="muted">
                  {s.lines} 行 · 量 {Math.round(s.qty)}
                </span>
              </li>
            ))}
          </ul>

          <div className="quick-links">
            <button type="button" onClick={() => void navigateToTable(TABLE.stock)}>
              打开站库存表
            </button>
            <button type="button" onClick={() => setTab('issue')}>
              批量领用{cart.length ? ` (${cart.length})` : ''}
            </button>
            <button type="button" onClick={() => void navigateToTable(TABLE.issue)}>
              打开出库流水
            </button>
          </div>
        </section>
      ) : null}

      {tab === 'stock' ? (
        <section className="panel">
          <div className="filters">
            <select value={stationFilter} onChange={(e) => setStationFilter(e.target.value)}>
              <option value="">全部站点</option>
              {stationOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name || s.code}
                </option>
              ))}
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜名称 / 规格 / 编码 / 货位"
            />
          </div>
          <p className="hint">
            单行日常消耗：在「站库存」表用原生「领用」按钮（见 OPS 文档）。本页只查库存；多行过账请用「批量领用」。
          </p>
          <p className="muted">
            共 {filteredStock.length} 行
            {cart.length ? ` · 批量清单 ${cart.length} 件` : ''}
          </p>
          <ul className="card-list">
            {filteredStock.slice(0, 80).map((r) => {
              const qty = cellToNumber(r.fields['现存量']);
              return (
                <li key={r.id}>
                  <div className="card-list__title">
                    {cellToText(r.fields['物资名称'])}
                    <em>{cellToText(r.fields['物资分类'])}</em>
                  </div>
                  <div className="card-list__meta">
                    {cellToText(r.fields['站点编码'])} · {truncateText(cellToText(r.fields['规格型号']), 28)}
                  </div>
                  <div className="card-list__row">
                    <span>货位 {cellToText(r.fields['存放地点']) || '-'}</span>
                    <strong>量 {qty}</strong>
                  </div>
                  {cellToText(r.fields['物料编码']) ? (
                    <div className="card-list__meta">码 {cellToText(r.fields['物料编码'])}</div>
                  ) : (
                    <div className="card-list__meta muted">编码空（另类批次可后补）</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {tab === 'issue' ? (
        <section className="panel">
          <p className="hint">
            对齐物资助手：在「站库存」勾选多行 → 本页「读取勾选」→ 改数量 → 二次确认过账（写流水再扣库存）。单行请用表格「领用」按钮。
          </p>
          <div className="quick-links" style={{ marginTop: 0, marginBottom: 8 }}>
            <button type="button" onClick={() => void navigateToTable(TABLE.stock)}>
              打开站库存 ↗
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void loadSelectionIntoCart()}>
              {busy ? '读取中…' : '读取勾选'}
            </button>
          </div>
          <div className="form-grid">
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="领用人（建议填写）"
            />
            <input
              value={issueRemark}
              onChange={(e) => setIssueRemark(e.target.value)}
              placeholder="用途 / 备注（可选）"
            />
          </div>

          {!cart.length ? (
            <p className="muted center">清单为空。请在站库存勾选后点「读取勾选」。</p>
          ) : (
            <ul className="card-list">
              {cart.map((line) => (
                <li key={line.key}>
                  <div className="card-list__title">
                    {line.name}
                    <em>{line.stationCode}</em>
                  </div>
                  <div className="card-list__meta">
                    {truncateText(line.spec, 36) || '无规格'} · 账面 {line.expectedQty} {line.unit}
                  </div>
                  <div className="card-list__row issue-qty-row">
                    <label>
                      领用数量
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        max={line.expectedQty}
                        value={line.qty}
                        onChange={(e) => updateCartQty(line.key, e.target.value)}
                      />
                    </label>
                    <button type="button" className="mini danger-mini" onClick={() => removeCartLine(line.key)}>
                      移除
                    </button>
                  </div>
                  {line.qty > line.expectedQty ? (
                    <div className="card-list__meta err-text">超过账面，无法过账</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {cartErrors.length && cart.length ? (
            <p className="err-text">{cartErrors[0]}</p>
          ) : null}

          {confirmPost && cart.length && !cartErrors.length ? (
            <div className="confirm-box">
              <strong>即将过账 {cart.length} 行</strong>
              <ul>
                {cart.map((c) => (
                  <li key={c.key}>
                    {c.name}：{c.expectedQty} → {Math.round((c.expectedQty - c.qty) * 100) / 100}（扣{' '}
                    {c.qty}）
                  </li>
                ))}
              </ul>
              <p className="muted">类型「{issueType}」· 领用人「{recipient.trim() || '站员'}」</p>
            </div>
          ) : null}

          <button
            type="button"
            className="primary"
            disabled={busy || !cart.length || cartErrors.length > 0}
            onClick={() => void submitIssue()}
          >
            {busy ? '过账中…' : confirmPost ? '确认过账（写流水并扣库存）' : '核对数量并过账'}
          </button>
          {confirmPost ? (
            <button
              type="button"
              className="secondary"
              style={{ width: '100%', marginTop: 6 }}
              onClick={() => setConfirmPost(false)}
            >
              返回修改
            </button>
          ) : null}

          <div className="quick-links" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => void navigateToTable(TABLE.issue)}>
              查出库流水
            </button>
            <button type="button" onClick={() => setCart([])}>
              清空清单
            </button>
          </div>
        </section>
      ) : null}

      {tab === 'find' ? (
        <section className="panel">
          <p className="hint">按名称+规格看各站还有没有货，可一键填入调拨。</p>
          <input
            className="full"
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            placeholder="输入物资名称或规格关键字"
          />
          {!findQ.trim() ? <p className="muted center">输入关键字开始查找</p> : null}
          {findHits.map(({ key, hits }) => {
            const [name, spec] = key.split('||');
            return (
              <div key={key} className="find-block">
                <div className="find-block__title">
                  {name}
                  <span>{spec || '无规格'}</span>
                </div>
                <ul className="simple-list">
                  {hits.map((h, i) => (
                    <li key={`${h.station}-${h.loc}-${i}`}>
                      <span>
                        {h.station} · 量 {h.qty}
                        {h.loc ? ` · ${h.loc}` : ''}
                      </span>
                      <button
                        type="button"
                        className="mini"
                        onClick={() => {
                          const to =
                            stationFilter && stationFilter !== h.station
                              ? stationFilter
                              : stationOptions.find((s) => s.code !== h.station)?.code || '';
                          fillTransferFromHit(h, to);
                        }}
                      >
                        调拨
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}

      {tab === 'transfer' ? (
        <section className="panel">
          <h3 className="sec-title">发起调拨</h3>
          <div className="form-grid">
            <input value={tfName} onChange={(e) => setTfName(e.target.value)} placeholder="物资名称 *" />
            <input value={tfSpec} onChange={(e) => setTfSpec(e.target.value)} placeholder="规格型号" />
            <select value={tfCat} onChange={(e) => setTfCat(e.target.value)}>
              <option value="工器具">工器具</option>
              <option value="耗材">耗材</option>
            </select>
            <input value={tfCode} onChange={(e) => setTfCode(e.target.value)} placeholder="物料编码（可选）" />
            <select value={tfFrom} onChange={(e) => setTfFrom(e.target.value)}>
              <option value="">调出站 *</option>
              {stationOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name || s.code}
                </option>
              ))}
            </select>
            <select value={tfTo} onChange={(e) => setTfTo(e.target.value)}>
              <option value="">调入站 *</option>
              {stationOptions.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name || s.code}
                </option>
              ))}
            </select>
            <input value={tfQty} onChange={(e) => setTfQty(e.target.value)} placeholder="数量" />
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || !tfName.trim() || !tfFrom || !tfTo || tfFrom === tfTo}
            onClick={() => void submitTransfer()}
          >
            {busy ? '提交中…' : '提交调拨申请'}
          </button>

          <h3 className="sec-title">调拨列表</h3>
          <ul className="card-list">
            {transfers
              .slice()
              .reverse()
              .slice(0, 50)
              .map((r) => (
                <li key={r.id}>
                  <div className="card-list__title">
                    {cellToText(r.fields['物资名称'])}
                    <em>{cellToText(r.fields['状态'])}</em>
                  </div>
                  <div className="card-list__meta">
                    {cellToText(r.fields['调出站点编码'])} → {cellToText(r.fields['调入站点编码'])} · 量{' '}
                    {cellToNumber(r.fields['数量'])}
                  </div>
                  <div className="card-list__meta">{cellToText(r.fields['调拨单号'])}</div>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {tab === 'audit' ? (
        <section className="panel">
          <p className="muted">最近修改 / 导入记录（管理员查看）</p>
          <ul className="card-list">
            {audits
              .slice()
              .reverse()
              .slice(0, 60)
              .map((r) => (
                <li key={r.id}>
                  <div className="card-list__title">
                    {cellToText(r.fields['操作类型'])}
                    <em>{cellToText(r.fields['站点编码'])}</em>
                  </div>
                  <div className="card-list__meta">
                    {cellToText(r.fields['字段名'])} {cellToText(r.fields['旧值'])} →{' '}
                    {cellToText(r.fields['新值'])}
                  </div>
                  <div className="card-list__meta">
                    {cellToText(r.fields['操作人'])} · {cellToText(r.fields['结存键'])}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {tab === 'acl' ? (
        <section className="panel">
          <p className="hint">
            在「人员站点权限」表维护人↔站；再用多维表格高级权限按站点行过滤后，站员只能改本站。本页只读预览。
          </p>
          <button type="button" className="secondary" onClick={() => void navigateToTable(TABLE.acl)}>
            打开权限表编辑
          </button>
          <ul className="card-list" style={{ marginTop: 10 }}>
            {acl.length === 0 ? <li className="muted center">暂无权限行，请先在表中添加</li> : null}
            {acl.map((r) => (
              <li key={r.id}>
                <div className="card-list__title">
                  {cellToText(r.fields['人员姓名']) || cellToText(r.fields['人员标识'])}
                  <em>{cellToText(r.fields['角色'])}</em>
                </div>
                <div className="card-list__meta">
                  站 {cellToText(r.fields['站点编码'])} · 标识 {cellToText(r.fields['人员标识'])}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
