import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import type { AssetAllocation, AssetDetail } from "@shared/schema";
import { useDisplayCurrency } from "@/lib/currency-context";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

interface AssetAllocationChartProps {
  data: AssetAllocation[];
  assets: AssetDetail[];
}

const CATEGORY_COLORS: Record<string, string> = {
  hisse: "hsl(var(--chart-1))",
  etf: "hsl(var(--chart-2))",
  kripto: "hsl(var(--chart-4))",
  gayrimenkul: "hsl(var(--chart-5))",
  bes: "hsl(var(--chart-3))",
};

const INDIVIDUAL_PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#f97316",
  "#14b8a6", "#84cc16", "#6366f1", "#a855f7",
];

type ViewMode = "category" | "individual";

interface ChartEntry {
  name: string;
  fullName?: string;
  value: number;
  percentage: number;
  color: string;
  type?: string;
}

export function AssetAllocationChart({ data, assets }: AssetAllocationChartProps) {
  const { formatDisplayCurrency, exchangeRates } = useDisplayCurrency();
  const [viewMode, setViewMode] = useState<ViewMode>("category");
  const [drillDownType, setDrillDownType] = useState<string | null>(null);

  const hasData = (data && data.length > 0) || (assets && assets.length > 0);
  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        Varlık bulunmamaktadır
      </div>
    );
  }

  // Get TRY value for an asset using frontend exchange rates
  const getAssetValueTRY = (asset: AssetDetail): number => {
    const quantity = Number(asset.quantity) || 0;
    const price = Number(asset.currentPrice) || 0;
    const rate = (exchangeRates as Record<string, number>)[asset.currency] ?? 1;
    return quantity * price * rate;
  };

  // Compute per-asset allocation (optionally filtered by type)
  const computeIndividualData = (filterType?: string): ChartEntry[] => {
    const filtered = filterType ? assets.filter((a) => a.type === filterType) : assets;
    const total = filtered.reduce((sum, a) => sum + getAssetValueTRY(a), 0);
    return filtered
      .map((a, idx) => ({
        name: a.symbol || a.name,
        fullName: a.name,
        value: getAssetValueTRY(a),
        percentage: total > 0 ? (getAssetValueTRY(a) / total) * 100 : 0,
        color: INDIVIDUAL_PALETTE[idx % INDIVIDUAL_PALETTE.length],
      }))
      .filter((a) => a.value > 0)
      .sort((a, b) => b.value - a.value);
  };

  // Determine what to show
  let chartData: ChartEntry[];
  let chartTitle: string;
  let isClickable = false;

  if (viewMode === "individual") {
    chartData = computeIndividualData();
    chartTitle = "Tüm Varlıklar";
  } else if (drillDownType) {
    chartData = computeIndividualData(drillDownType);
    chartTitle = data.find((d) => d.type === drillDownType)?.name ?? drillDownType;
  } else {
    chartData = data.map((item) => ({
      name: item.name,
      value: item.value,
      percentage: item.percentage,
      color: CATEGORY_COLORS[item.type] ?? CATEGORY_COLORS.hisse,
      type: item.type,
    }));
    chartTitle = "Kategoriler";
    isClickable = true;
  }

  const handlePieClick = (entry: any) => {
    if (!isClickable) return;
    const found = data.find((d) => d.name === entry.name);
    if (found) setDrillDownType(found.type);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const item = payload[0].payload;
    return (
      <div className="bg-popover border rounded-md p-3 shadow-md text-popover-foreground">
        <p className="font-medium text-sm">{item.fullName ?? item.name}</p>
        <p className="text-sm text-muted-foreground">{formatDisplayCurrency(item.value)}</p>
        <p className="text-sm font-semibold">{item.percentage.toFixed(1)}%</p>
      </div>
    );
  };

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.05) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Header: back button + mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 min-h-[28px]">
          {drillDownType && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setDrillDownType(null)}
            >
              <ChevronLeft className="h-3 w-3 mr-0.5" />
              Geri
            </Button>
          )}
          <span className="text-sm font-medium text-muted-foreground">{chartTitle}</span>
        </div>

        <div className="flex rounded-md border overflow-hidden text-xs">
          <button
            className={`px-3 py-1 transition-colors ${
              viewMode === "category" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
            onClick={() => {
              setViewMode("category");
              setDrillDownType(null);
            }}
          >
            Kategoriler
          </button>
          <button
            className={`px-3 py-1 transition-colors ${
              viewMode === "individual" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
            onClick={() => {
              setViewMode("individual");
              setDrillDownType(null);
            }}
          >
            Bireysel
          </button>
        </div>
      </div>

      {isClickable && (
        <p className="text-xs text-muted-foreground">
          Detayları görmek için bir kategoriye tıklayın
        </p>
      )}

      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={CustomLabel}
            outerRadius={100}
            dataKey="value"
            onClick={isClickable ? handlePieClick : undefined}
            style={isClickable ? { cursor: "pointer" } : undefined}
            isAnimationActive={true}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value, entry: any) => (
              <span className="text-xs">
                {value} ({entry.payload.percentage.toFixed(1)}%)
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
