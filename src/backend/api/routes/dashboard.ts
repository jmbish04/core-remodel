/**
 * @fileoverview Dashboard API routes
 */

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq, and, gte } from 'drizzle-orm';
import { dashboardMetrics } from '../../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../index';

const dashboardRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Apply auth middleware to all routes
dashboardRouter.use('*', authMiddleware);

// GET /api/dashboard/metrics
dashboardRouter.get('/metrics', async (c) => {
  const db = drizzle(c.env.DB);
  const category = c.req.query('category');
  const limit = parseInt(c.req.query('limit') || '100');

  try {
    let query = db.select().from(dashboardMetrics);

    if (category) {
      query = query.where(eq(dashboardMetrics.category, category));
    }

    const metrics = await query
      .orderBy(desc(dashboardMetrics.timestamp))
      .limit(limit);

    // Group metrics by category
    const grouped = metrics.reduce((acc, metric) => {
      if (!acc[metric.category]) {
        acc[metric.category] = [];
      }
      acc[metric.category].push(metric);
      return acc;
    }, {} as Record<string, typeof metrics>);

    return c.json({
      metrics,
      grouped,
      total: metrics.length,
    });
  } catch (error) {
    console.error('Error fetching dashboard metrics:', error);
    return c.json({ error: 'Failed to fetch metrics' }, 500);
  }
});

// GET /api/dashboard/summary
dashboardRouter.get('/summary', async (c) => {
  const db = drizzle(c.env.DB);

  try {
    // Get latest metrics for each category
    const allMetrics = await db
      .select()
      .from(dashboardMetrics)
      .orderBy(desc(dashboardMetrics.timestamp))
      .limit(1000);

    // Get the most recent metric for each metric name
    const latestMetrics = allMetrics.reduce((acc, metric) => {
      if (!acc[metric.metricName] || new Date(metric.timestamp) > new Date(acc[metric.metricName].timestamp)) {
        acc[metric.metricName] = metric;
      }
      return acc;
    }, {} as Record<string, typeof allMetrics[0]>);

    return c.json({
      summary: Object.values(latestMetrics),
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return c.json({ error: 'Failed to fetch summary' }, 500);
  }
});

// GET /api/dashboard/charts/:category
dashboardRouter.get('/charts/:category', async (c) => {
  const db = drizzle(c.env.DB);
  const category = c.req.param('category');
  const days = parseInt(c.req.query('days') || '7');

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startTimestamp = Math.floor(startDate.getTime() / 1000);

    const metrics = await db
      .select()
      .from(dashboardMetrics)
      .where(
        and(
          eq(dashboardMetrics.category, category),
          gte(dashboardMetrics.timestamp, startTimestamp)
        )
      )
      .orderBy(desc(dashboardMetrics.timestamp));

    // Format data for charts
    const chartData = metrics.map((m) => ({
      timestamp: m.timestamp,
      value: m.metricValue,
      name: m.metricName,
      type: m.metricType,
    }));

    return c.json({ data: chartData });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return c.json({ error: 'Failed to fetch chart data' }, 500);
  }
});

export { dashboardRouter };
