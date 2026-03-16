import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertAssetSchema, type InsertAsset, type Asset } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEffect } from "react";

interface EditAssetDialogProps {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BES_COMPANIES = [
  "Anadolu Hayat Emeklilik",
  "Garanti BBVA Emeklilik",
  "Türkiye Hayat ve Emeklilik",
  "AgeSA Hayat ve Emeklilik",
  "Allianz Yaşam ve Emeklilik",
  "AXA Hayat ve Emeklilik",
  "Katılım Emeklilik ve Hayat",
  "BNP Paribas Cardif Emeklilik",
  "MetLife Emeklilik ve Hayat",
  "HDI Fiba Emeklilik ve Hayat",
  "Bereket Emeklilik ve Hayat",
  "Zurich Yaşam ve Emeklilik",
  "Viennalife Emeklilik ve Hayat",
  "QNB Sağlık Hayat Sigorta ve Emeklilik",
  "Diğer",
];

export function EditAssetDialog({ asset, open, onOpenChange }: EditAssetDialogProps) {
  const { toast } = useToast();

  const form = useForm<InsertAsset>({
    resolver: zodResolver(insertAssetSchema),
    defaultValues: {
      type: "hisse",
      name: "",
      symbol: "",
      market: "BIST",
      quantity: "",
      averagePrice: "",
      currentPrice: "",
      currency: "TRY",
    },
  });

  const currentType = form.watch("type");

  useEffect(() => {
    if (asset && open) {
      form.reset({
        type: asset.type,
        name: asset.name,
        symbol: asset.symbol,
        market: asset.market,
        quantity: asset.quantity,
        averagePrice: asset.averagePrice,
        currentPrice: asset.currentPrice,
        currency: asset.currency,
      });
    }
  }, [asset, open]);

  const updateMutation = useMutation({
    mutationFn: async (data: InsertAsset) => {
      return await apiRequest("PATCH", `/api/assets/${asset!.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/allocation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/details"] });
      toast({ title: "Başarılı", description: "Varlık güncellendi" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Hata", description: "Varlık güncellenirken bir hata oluştu", variant: "destructive" });
    },
  });

  const onSubmit = (data: InsertAsset) => {
    const currentPrice = data.currentPrice || "0";
    const averagePrice = data.averagePrice || currentPrice;
    const quantity = data.quantity || "0";
    updateMutation.mutate({ ...data, currentPrice, averagePrice, quantity });
  };

  if (!asset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Varlığı Düzenle</DialogTitle>
              <DialogDescription>Varlık bilgilerini güncelleyin</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Type + Market */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Varlık Türü</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="hisse">Hisse Senedi</SelectItem>
                          <SelectItem value="etf">ETF</SelectItem>
                          <SelectItem value="kripto">Kripto Para</SelectItem>
                          <SelectItem value="gayrimenkul">Gayrimenkul</SelectItem>
                          <SelectItem value="bes">BES / Emeklilik</SelectItem>
                          <SelectItem value="nakit">Nakit</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="market"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{currentType === "bes" ? "Aracı Kurum" : "Borsa"}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {currentType === "bes" ? (
                            BES_COMPANIES.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))
                          ) : currentType === "nakit" ? (
                            <SelectItem value="Nakit">Nakit</SelectItem>
                          ) : (
                            <>
                              <SelectItem value="BIST">Borsa İstanbul</SelectItem>
                              <SelectItem value="US">Amerikan Borsası</SelectItem>
                              <SelectItem value="Diğer">Diğer</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Varlık Adı</FormLabel>
                    <FormControl>
                      <Input placeholder="örn: Türk Hava Yolları" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Symbol */}
              <FormField
                control={form.control}
                name="symbol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sembol/Ticker</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="örn: THYAO"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Quantity + Currency */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{currentType === "nakit" ? "Tutar" : "Miktar"}</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.00000001" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Para Birimi</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="TRY">TRY (₺)</SelectItem>
                          <SelectItem value="USD">USD ($)</SelectItem>
                          <SelectItem value="EUR">EUR (€)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Average + Current price (hide for nakit) */}
              {currentType !== "nakit" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="averagePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ortalama Alış Fiyatı</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currentPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Güncel Fiyat</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                İptal
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
