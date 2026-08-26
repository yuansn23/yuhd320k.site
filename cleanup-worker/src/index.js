// StreamFlix 每周清理任务
// 每周一 UTC 03:37 触发：删除 5 天前的访问/点击日志 + 预聚合计数
// 说明：只清理只增日志表，配置/账户表不受影响。删除失败不影响其它表（逐表 try/catch，fail-open）。
export default {
  async scheduled(event, env, ctx) {
    const results = [];

    // 日志表：时间列为 ISO UTC 字符串，直接字符串比较
    const logTables = [
      { table: 'visit_logs', col: 'visit_time' },
      { table: 'click_logs', col: 'click_time' },
    ];

    for (const t of logTables) {
      try {
        const r = await env.DB.prepare(
          `DELETE FROM ${t.table} WHERE ${t.col} < datetime('now', '-5 days')`
        ).run();
        results.push(`${t.table}:-${(r.meta && r.meta.changes) || 0}`);
      } catch (e) {
        results.push(`${t.table}:ERR ${e.message}`);
      }
    }

    // 预聚合表：date 列为 YYYY-MM-DD
    try {
      const r = await env.DB.prepare(
        `DELETE FROM stats_daily WHERE date < date('now', '-5 days')`
      ).run();
      results.push(`stats_daily:-${(r.meta && r.meta.changes) || 0}`);
    } catch (e) {
      results.push(`stats_daily:ERR ${e.message}`);
    }

    console.log('cleanup done:', results.join(', '));
    return results;
  },
};
