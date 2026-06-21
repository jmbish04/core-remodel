"use client";

import { Card, CardContent, CardHeader } from "src/frontend/components/ui/card";
import { ChartContainer } from "src/frontend/components/ui/chart";
import { TrendingUp } from "lucide-react";
import { Area, AreaChart, Cell, Pie, PieChart } from "recharts";
import {
  deviceCategoryChartConfig,
  deviceCategoryData,
  usersPerDay,
  usersPerDayChartConfig,
} from "../data";

function MetricChart() {
  return (
    <ChartContainer
      config={usersPerDayChartConfig}
      className="aspect-auto h-8 w-full"
    >
      <AreaChart data={usersPerDay} margin={{ left: 4, right: 4, top: 4 }}>
        <defs>
          <linearGradient id="usersGradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-users)"
              stopOpacity={0.4}
            />
            <stop
              offset="100%"
              stopColor="var(--color-users)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>

        <Area
          type="natural"
          dataKey="users"
          stroke="var(--color-users)"
          strokeWidth={1.5}
          fill="url(#usersGradient)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function OverviewCard() {
  return (
    <Card className="bg-card/70 absolute top-4 left-4 z-10 w-60 backdrop-blur-sm">
      <CardHeader>
        <div>
          <p className="text-muted-foreground pb-2 text-[10px] tracking-wider uppercase">
            Users in last 7 days
          </p>
          <p className="text-3xl leading-none font-semibold">3,803</p>
        </div>
      </CardHeader>

      <CardContent>
        <MetricChart />
        <div className="mt-4 flex items-center gap-1.5 text-xs">
          <TrendingUp className="size-3 text-emerald-500" />
          <span className="font-medium text-emerald-500">+12.5%</span>
          <span className="text-muted-foreground">vs previous 7 days</span>
        </div>

        <div className="border-border/60 mt-4 border-t pt-4">
          <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Device category in last 7 days
          </p>

          <ChartContainer
            config={deviceCategoryChartConfig}
            className="mx-auto mt-3 aspect-square h-32 w-32"
          >
            <PieChart>
              <Pie
                data={deviceCategoryData}
                dataKey="value"
                nameKey="name"
                innerRadius={32}
                outerRadius={52}
                strokeWidth={2}
              >
                {deviceCategoryData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {deviceCategoryData.map((device) => (
              <div key={device.name} className="text-center">
                <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-[10px] tracking-wide uppercase">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: device.fill }}
                  />
                  {device.name}
                </p>
                <p className="text-foreground mt-1 leading-none font-medium tabular-nums">
                  {device.value}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
