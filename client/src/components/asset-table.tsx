import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Trash2, TrendingUp, TrendingDown, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AssetDetail, Asset } from "@shared/schema";
import { useState } from "react";
import { AddAssetDialog } from "./add-asset-dialog";

interface AssetTableProps {
  assets: AssetDetail[];
}

type GroupedAsset = {
  key: string;
  name: string;
  symbol: string;
  type: string;
  market: string;
  currency: string;
  totalQuantity: number;
  weightedAvgPrice: number;
  currentPrice: number;
  totalValue: number;
  change: number;
  items: AssetDetail[];
};

function groupAssets(assets: AssetDetail[]): GroupedAsset[] {
  const groups = new Map<string, AssetDetail[]>();

  for (const asset of assets) {
    const key = `${asset.symbol}_${asset.currency}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(asset);
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const first = items[0];
    const totalQuantity = items.reduce((sum, a) => sum + Number(a.quantity), 0);
    const totalCost = items.reduce((sum, a) => sum + Number(a.quantity) * Number(a.averagePrice), 0);
    const weightedAvgPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    // Use the most recently fetched current price (first item, sorted by server)
    const currentPrice = Number(first.currentPrice);
    const totalValue = totalQuantity * currentPrice;
    const change = weightedAvgPrice > 0 ? ((currentPrice - weightedAvgPrice) / weightedAvgPrice) * 100 : 0;

    return {
      key,
      name: first.name,
      symbol: first.symbol,
      type: first.type,
      market: first.market,
      currency: first.currency,
      totalQuantity,
      weightedAvgPrice,
      currentPrice,
      totalValue,
      change,
      items,
    };
  });
}

export function AssetTable({ assets }: AssetTableProps) {
  const { toast } = useToast();
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/assets/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/allocation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/details"] });
      toast({ title: "Başarılı", description: "Varlık başarıyla silindi" });
    },
    onError: () => {
      toast({ title: "Hata", description: "Varlık silinirken bir hata oluştu", variant: "destructive" });
    },
  });

  const formatCurrency = (amount: number | undefined, currency: string) => {
    const symbols: Record<string, string> = { TRY: "₺", USD: "$", EUR: "€" };
    const value = amount ?? 0;
    return `${symbols[currency] || ""}${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (percent: number) => `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;

  const assetTypeNames: Record<string, string> = {
    hisse: "Hisse",
    etf: "ETF",
    kripto: "Kripto",
    gayrimenkul: "Gayrimenkul",
    bes: "BES",
    nakit: "Nakit",
  };

  if (assets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="empty-assets">
        <p>Henüz varlık eklenmemiş</p>
        <p className="text-sm mt-1">Portföyünüze varlık eklemek için yukarıdaki butonu kullanın</p>
      </div>
    );
  }

  const groups = groupAssets(assets);

  return (
    <>
      <AddAssetDialog
        editAsset={editingAsset ?? undefined}
        open={editingAsset !== null}
        onOpenChange={(open) => { if (!open) setEditingAsset(null); }}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Varlık</TableHead>
              <TableHead>Tip</TableHead>
              <TableHead>Borsa</TableHead>
              <TableHead className="text-right">Miktar</TableHead>
              <TableHead className="text-right">Ort. Fiyat</TableHead>
              <TableHead className="text-right">Güncel Fiyat</TableHead>
              <TableHead className="text-right">Toplam Değer</TableHead>
              <TableHead className="text-right">Değişim</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const isMulti = group.items.length > 1;
              const isExpanded = expandedGroups.has(group.key);

              return (
                <>
                  {/* Group / single row */}
                  <TableRow
                    key={group.key}
                    data-testid={`asset-group-${group.key}`}
                    className={isMulti ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={isMulti ? () => toggleGroup(group.key) : undefined}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1">
                        {isMulti && (
                          <span className="text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </span>
                        )}
                        <div>
                          <div>{group.name}</div>
                          <div className="text-sm text-muted-foreground">{group.symbol}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{assetTypeNames[group.type] || group.type}</TableCell>
                    <TableCell>{group.market}</TableCell>
                    <TableCell className="text-right">
                      {group.totalQuantity.toLocaleString("tr-TR", { maximumFractionDigits: 8 })}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(group.weightedAvgPrice, group.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(group.currentPrice, group.currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(group.totalValue, group.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={`flex items-center justify-end gap-1 ${group.change >= 0 ? "text-success" : "text-destructive"}`}>
                        {group.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                        <span>{formatPercent(group.change)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* Single asset: show edit/delete directly */}
                      {!isMulti && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); setEditingAsset(group.items[0]); }}
                            data-testid={`button-edit-${group.items[0].id}`}
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(group.items[0].id); }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-${group.items[0].id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>

                  {/* Sub-rows for multi-asset groups */}
                  {isMulti && isExpanded && group.items.map((asset, idx) => (
                    <TableRow
                      key={asset.id}
                      data-testid={`asset-row-${asset.id}`}
                      className="bg-muted/30 border-l-2 border-l-primary/20"
                    >
                      <TableCell className="font-medium pl-8">
                        <div className="text-sm text-muted-foreground">
                          İşlem {idx + 1}
                        </div>
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right text-sm">
                        {Number(asset.quantity).toLocaleString("tr-TR", { maximumFractionDigits: 8 })}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(Number(asset.averagePrice), asset.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(Number(asset.currentPrice), asset.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatCurrency(asset.totalValue, asset.currency)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <div className={`flex items-center justify-end gap-1 ${asset.change >= 0 ? "text-success" : "text-destructive"}`}>
                          {asset.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          <span>{formatPercent(asset.change)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingAsset(asset)}
                            data-testid={`button-edit-${asset.id}`}
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(asset.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-${asset.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
