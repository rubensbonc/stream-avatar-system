const { db } = require('../config/database');
const crypto = require('crypto');

class ErrorLogger {
  /**
   * Generate a short human-readable error ID like "ERR-A1B2"
   */
  _generateErrorId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'ERR-';
    for (let i = 0; i < 4; i++) {
      id += chars[crypto.randomInt(chars.length)];
    }
    return id;
  }

  /**
   * Log an error to the database.
   * Designed to never throw -- falls back to console.error if DB logging fails.
   */
  async logError(err, { req, userId, source, severity = 'error', metadata } = {}) {
    try {
      const errorId = this._generateErrorId();
      await db.query(`
        INSERT INTO error_logs (error_id, severity, source, user_id, method, path, message, stack, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        errorId,
        severity,
        source || null,
        userId || req?.session?.userId || null,
        req?.method || null,
        req?.originalUrl || req?.path || null,
        err?.message || String(err),
        err?.stack || null,
        metadata ? JSON.stringify(metadata) : null,
      ]);

      console.error(`[${errorId}] ${severity}: ${err?.message || err}`);
      return errorId;
    } catch (logErr) {
      console.error('ErrorLogger failed to write:', logErr.message);
      console.error('Original error:', err);
      return null;
    }
  }

  /**
   * Get paginated errors with optional filters.
   */
  async getErrors({ limit = 50, offset = 0, resolved, severity } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (resolved !== undefined) {
      conditions.push(`el.resolved = $${idx++}`);
      params.push(resolved);
    }
    if (severity) {
      conditions.push(`el.severity = $${idx++}`);
      params.push(severity);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(limit);
    params.push(offset);

    return db.getMany(`
      SELECT el.*, u.display_name
      FROM error_logs el
      LEFT JOIN users u ON u.id = el.user_id
      ${where}
      ORDER BY el.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);
  }

  /**
   * Get error stats for the admin dashboard.
   */
  async getErrorStats() {
    const [total, unresolved, last24h, bySeverity] = await Promise.all([
      db.getOne('SELECT COUNT(*) as count FROM error_logs'),
      db.getOne('SELECT COUNT(*) as count FROM error_logs WHERE resolved = FALSE'),
      db.getOne("SELECT COUNT(*) as count FROM error_logs WHERE created_at > NOW() - INTERVAL '24 hours'"),
      db.getMany(`
        SELECT severity, COUNT(*) as count
        FROM error_logs
        WHERE resolved = FALSE
        GROUP BY severity
      `),
    ]);

    const severityCounts = {};
    bySeverity.forEach(r => { severityCounts[r.severity] = parseInt(r.count); });

    return {
      total: parseInt(total.count),
      unresolved: parseInt(unresolved.count),
      last_24h: parseInt(last24h.count),
      by_severity: severityCounts,
    };
  }

  /**
   * Mark an error as resolved.
   */
  async resolveError(errorId) {
    const result = await db.getOne(
      'UPDATE error_logs SET resolved = TRUE WHERE error_id = $1 RETURNING *',
      [errorId]
    );
    return result ? { success: true } : { success: false, error: 'Error not found' };
  }

  /**
   * Bulk delete resolved errors.
   */
  async clearResolved() {
    const result = await db.query('DELETE FROM error_logs WHERE resolved = TRUE');
    return { success: true, deleted: result.rowCount };
  }
}

module.exports = new ErrorLogger();
