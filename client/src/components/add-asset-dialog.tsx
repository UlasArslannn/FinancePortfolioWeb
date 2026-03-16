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
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, Search, Loader2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";

interface AddAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editAsset?: Asset;
}

interface StockResult {
  symbol: string;
  name: string;
  exchange: string;
  price?: number;
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

export function AddAssetDialog({ open, onOpenChange, editAsset }: AddAssetDialogProps) {
  const { toast } = useToast();
  const isEditing = !!editAsset;
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);

  // Stock search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StockResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Miktar / Tutar mode
  const [inputMode, setInputMode] = useState<"miktar" | "tutar">("miktar");
  // In tutar mode: yatirimTutari = current total value of the position
  const [yatirimTutari, setYatirimTutari] = useState("");

  // Kar/zarar yüzdesi
  const [karYuzdeManuel, setKarYuzdeManuel] = useState(false);
  const [karYuzdeInput, setKarYuzdeInput] = useState("");

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

  const currentMarket = form.watch("market");
  const currentType = form.watch("type");
  const currentCurrency = form.watch("currency");
  const watchedCurrentPrice = parseFloat(form.watch("currentPrice") || "0");
  const watchedAveragePrice = parseFloat(form.watch("averagePrice") || "0");

  // Pre-fill form when editing
  useEffect(() => {
    if (editAsset && open) {
      form.reset({
        type: editAsset.type,
        name: editAsset.name,
        symbol: editAsset.symbol,
        market: editAsset.market,
        quantity: editAsset.quantity,
        averagePrice: editAsset.averagePrice,
        currentPrice: editAsset.currentPrice,
        currency: editAsset.currency,
      });
      // Compute initial kar/zarar from existing data
      const cp = parseFloat(editAsset.currentPrice || "0");
      const ap = parseFloat(editAsset.averagePrice || "0");
      if (ap > 0) {
        setKarYuzdeInput(((cp - ap) / ap * 100).toFixed(2));
      }
      setInputMode("miktar");
      setYatirimTutari("");
    }
  }, [editAsset, open]);

  // Sync kar yüzdesi display when not manual
  useEffect(() => {
    if (!karYuzdeManuel) {
      if (watchedAveragePrice > 0) {
        const yuzde = ((watchedCurrentPrice - watchedAveragePrice) / watchedAveragePrice) * 100;
        setKarYuzdeInput(yuzde.toFixed(2));
      } else {
        setKarYuzdeInput("");
      }
    }
  }, [watchedCurrentPrice, watchedAveragePrice, karYuzdeManuel, inputMode]);

  const handleKarYuzdeChange = (value: string) => {
    setKarYuzdeInput(value);
    // Back-calculate averagePrice from currentPrice in both modes
    const yuzde = parseFloat(value);
    if (!isNaN(yuzde) && watchedCurrentPrice > 0) {
      const newAvgPrice = watchedCurrentPrice / (1 + yuzde / 100);
      form.setValue("averagePrice", newAvgPrice.toFixed(2));
    }
  };

  // When switching to BES, force TRY currency and set default company
  useEffect(() => {
    if (currentType === "bes") {
      form.setValue("currency", "TRY");
      if (!BES_COMPANIES.includes(form.getValues("market"))) {
        form.setValue("market", BES_COMPANIES[0]);
      }
    } else if (currentType !== "bes" && BES_COMPANIES.includes(form.getValues("market"))) {
      form.setValue("market", "BIST");
    }
    if (currentType === "nakit") {
      form.setValue("market", "Nakit");
      form.setValue("averagePrice", "1");
      form.setValue("currentPrice", "1");
      form.setValue("symbol", form.getValues("currency"));
    } else if (form.getValues("market") === "Nakit") {
      form.setValue("market", "BIST");
    }
  }, [currentType]);

  // Sync nakit symbol with selected currency
  useEffect(() => {
    if (currentType === "nakit") {
      form.setValue("symbol", currentCurrency);
    }
  }, [currentCurrency, currentType]);

  // Auto-set currency based on market selection
  useEffect(() => {
    if (currentType === "bes") return;
    if (currentMarket === "US" || currentMarket === "Diğer") {
      form.setValue("currency", "USD");
    } else if (currentMarket === "BIST") {
      form.setValue("currency", "TRY");
    }
  }, [currentMarket, currentType]);

  // Reset search when market or type changes
  useEffect(() => {
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
  }, [currentMarket, currentType]);

  // Reset everything when dialog closes
  useEffect(() => {
    if (!open) {
      form.reset({
        type: "hisse",
        name: "",
        symbol: "",
        market: "BIST",
        quantity: "",
        averagePrice: "",
        currentPrice: "",
        currency: "TRY",
      });
      setSearchQuery("");
      setSearchResults([]);
      setShowDropdown(false);
      setInputMode("miktar");
      setYatirimTutari("");
      setKarYuzdeManuel(false);
      setKarYuzdeInput("");
    }
  }, [open]);

  // Debounced search (stocks or BES funds) — hidden in edit mode
  useEffect(() => {
    if (isEditing) return;
    const minLen = currentType === "bes" ? 1 : 2;
    if (!searchQuery || searchQuery.length < minLen) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const url =
          currentType === "bes"
            ? `/api/bes/search?q=${encodeURIComponent(searchQuery)}`
            : `/api/stocks/search?q=${encodeURIComponent(searchQuery)}&market=${currentMarket}&type=${currentType}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data);
          setShowDropdown(data.length > 0);
        }
      } catch {
        // silently ignore
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, currentMarket, currentType, isEditing]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectResult = (result: StockResult) => {
    form.setValue("symbol", result.symbol);
    form.setValue("name", result.name);
    if (result.price && result.price > 0) {
      form.setValue("currentPrice", result.price.toFixed(4));
    }
    setSearchQuery(`${result.symbol} — ${result.name}`);
    setShowDropdown(false);
  };

  const fetchCurrentPrice = async () => {
    const symbol = form.getValues("symbol");
    const type = form.getValues("type");
    const market = form.getValues("market");

    if (!symbol) {
      toast({ title: "Uyarı", description: "Lütfen önce sembol giriniz", variant: "destructive" });
      return;
    }

    setIsFetchingPrice(true);
    try {
      const response = await fetch(`/api/prices/${symbol}?type=${type}&market=${market}`);
      if (response.ok) {
        const data = await response.json();
        form.setValue("currentPrice", data.price.toFixed(2));
        toast({ title: "Fiyat Güncellendi", description: `${symbol} güncel fiyatı: ${data.price.toFixed(2)}` });
      } else {
        toast({ title: "Fiyat Bulunamadı", description: "Bu sembol için fiyat bilgisi alınamadı", variant: "destructive" });
      }
    } catch {
      toast({ title: "Hata", description: "Fiyat bilgisi alınırken bir hata oluştu", variant: "destructive" });
    } finally {
      setIsFetchingPrice(false);
    }
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/portfolio/allocation"] });
    queryClient.invalidateQueries({ queryKey: ["/api/portfolio/performance"] });
    queryClient.invalidateQueries({ queryKey: ["/api/portfolio/details"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: InsertAsset) => {
      return await apiRequest("POST", "/api/assets", data);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Başarılı", description: "Varlık başarıyla eklendi" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ title: "Hata", description: error?.message || "Varlık eklenirken bir hata oluştu", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertAsset) => {
      return await apiRequest("PATCH", `/api/assets/${editAsset!.id}`, data);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Başarılı", description: "Varlık güncellendi" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ title: "Hata", description: error?.message || "Varlık güncellenirken bir hata oluştu", variant: "destructive" });
    },
  });

  const onSubmit = (data: InsertAsset) => {
    let finalData: InsertAsset;

    if (inputMode === "tutar") {
      // Tutar = current total value of the position
      // quantity = tutar / currentPrice, averagePrice = currentPrice / (1 + kar%)
      const tutar = parseFloat(yatirimTutari || "0");
      const karYuzde = parseFloat(karYuzdeInput || "0");
      const currentPrice = parseFloat(data.currentPrice || "0");

      let quantity: string;
      let avgPrice: number;

      if (currentPrice > 0) {
        quantity = (tutar / currentPrice).toFixed(8);
        avgPrice = karYuzde === 0 ? currentPrice : currentPrice / (1 + karYuzde / 100);
      } else {
        // currentPrice bilinmiyorsa tutarı fiyat olarak kabul et, miktar=1
        quantity = "1";
        avgPrice = karYuzde === 0 ? tutar : tutar / (1 + karYuzde / 100);
      }

      finalData = {
        ...data,
        quantity,
        currentPrice: currentPrice > 0 ? data.currentPrice! : tutar.toFixed(2),
        averagePrice: avgPrice.toFixed(2),
      };
    } else {
      const currentPrice = data.currentPrice || "0";
      const averagePrice = data.averagePrice || currentPrice;
      const quantity = data.quantity || "0";
      finalData = { ...data, currentPrice, averagePrice, quantity };
    }

    if (isEditing) {
      updateMutation.mutate(finalData);
    } else {
      createMutation.mutate(finalData);
    }
  };

  const isPending = isEditing ? updateMutation.isPending : createMutation.isPending;

  const searchPlaceholder =
    currentType === "bes"
      ? "Fon adı veya kodu ara... (örn: Hisse, GAH)"
      : currentType === "kripto"
      ? "Bitcoin, Ethereum, BNB ara..."
      : currentMarket === "BIST"
      ? "THYAO, Garanti, Akbank ara..."
      : currentMarket === "US"
      ? "AAPL, Tesla, Microsoft ara..."
      : "Şirket adı veya sembol ara...";

  const karRenk =
    parseFloat(karYuzdeInput) > 0
      ? "text-green-600"
      : parseFloat(karYuzdeInput) < 0
      ? "text-red-500"
      : "text-muted-foreground";

  const karEditable = karYuzdeManuel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]" data-testid="dialog-add-asset">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>{isEditing ? "Varlığı Düzenle" : "Yeni Varlık Ekle"}</DialogTitle>
              <DialogDescription>
                {isEditing ? "Varlık bilgilerini güncelleyin" : "Portföyünüze yeni bir varlık ekleyin"}
              </DialogDescription>
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
                          <SelectTrigger data-testid="select-asset-type">
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
                {currentType !== "nakit" && (
                <FormField
                  control={form.control}
                  name="market"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{currentType === "bes" ? "Aracı Kurum" : "Borsa"}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-market">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {currentType === "bes" ? (
                            BES_COMPANIES.map((company) => (
                              <SelectItem key={company} value={company}>{company}</SelectItem>
                            ))
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
                )}
              </div>

              {/* Stock search combobox — hidden in edit mode and for nakit */}
              {!isEditing && currentType !== "nakit" && (
              <div className="relative" ref={dropdownRef}>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium leading-none">
                    {currentType === "bes"
                      ? "BES Fonu Ara (TEFAS)"
                      : currentType === "kripto"
                      ? "Kripto Para Ara"
                      : "Hisse / ETF Ara"}
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={searchPlaceholder}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                      className="pl-8 pr-8"
                    />
                    {isSearching && (
                      <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
                    {searchResults.map((result) => (
                      <button
                        key={result.symbol}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                        onClick={() => handleSelectResult(result)}
                      >
                        <span className="font-semibold text-primary min-w-[60px]">{result.symbol}</span>
                        <span className="text-muted-foreground truncate">{result.name}</span>
                        {result.exchange && (
                          <span className="ml-auto text-xs text-muted-foreground shrink-0">{result.exchange}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* Name + Symbol */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Varlık Adı</FormLabel>
                    <FormControl>
                      <Input placeholder="örn: Türk Hava Yolları" {...field} data-testid="input-asset-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {currentType !== "nakit" && (
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
                        data-testid="input-asset-symbol"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}

              {/* Miktar / Tutar toggle + Currency */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  {currentType === "nakit" ? (
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tutar</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              {...field}
                              data-testid="input-quantity"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                  <>
                  {/* Toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium leading-none">
                      {inputMode === "miktar" ? "Miktar" : "Tutar"}
                    </label>
                    <div className="flex rounded-md border overflow-hidden text-xs">
                      <button
                        type="button"
                        onClick={() => setInputMode("miktar")}
                        className={`px-2 py-1 transition-colors ${
                          inputMode === "miktar" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                      >
                        Miktar
                      </button>
                      <button
                        type="button"
                        onClick={() => setInputMode("tutar")}
                        className={`px-2 py-1 transition-colors ${
                          inputMode === "tutar" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                      >
                        Tutar
                      </button>
                    </div>
                  </div>

                  {inputMode === "miktar" ? (
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.00000001"
                              placeholder="0"
                              {...field}
                              data-testid="input-quantity"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={yatirimTutari}
                      onChange={(e) => setYatirimTutari(e.target.value)}
                    />
                  )}
                  </>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Para Birimi</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-currency">
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

              {/* Average price + Current price — hidden for nakit */}
              {currentType !== "nakit" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="averagePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ortalama Alış Fiyatı</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          data-testid="input-average-price"
                        />
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
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...field}
                            data-testid="input-current-price"
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={fetchCurrentPrice}
                          disabled={isFetchingPrice}
                          data-testid="button-fetch-price"
                        >
                          <RefreshCw className={`h-4 w-4 ${isFetchingPrice ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              )}

              {/* Kar/Zarar yüzdesi — hidden for nakit */}
              {currentType !== "nakit" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className={`text-sm font-medium leading-none ${karRenk}`}>
                    Kar / Zarar
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id="karYuzdeManuel"
                      checked={karYuzdeManuel}
                      onCheckedChange={(checked) => {
                        setKarYuzdeManuel(!!checked);
                        if (!checked && watchedAveragePrice > 0) {
                          const yuzde = ((watchedCurrentPrice - watchedAveragePrice) / watchedAveragePrice) * 100;
                          setKarYuzdeInput(yuzde.toFixed(2));
                        }
                      }}
                    />
                    <label htmlFor="karYuzdeManuel" className="text-xs text-muted-foreground cursor-pointer select-none">
                      Manuel düzenle
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={karYuzdeInput}
                    onChange={(e) => handleKarYuzdeChange(e.target.value)}
                    disabled={!karEditable}
                    className={`${karRenk} ${!karEditable ? "opacity-70" : ""}`}
                  />
                  <span className={`text-sm font-medium ${karRenk} shrink-0`}>%</span>
                </div>
                {karYuzdeManuel && (
                  <p className="text-xs text-muted-foreground">
                    Güncel fiyat sabit, ortalama alış fiyatı bu orana göre güncelleniyor.
                  </p>
                )}
              </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                İptal
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-submit">
                {isPending
                  ? (isEditing ? "Kaydediliyor..." : "Ekleniyor...")
                  : (isEditing ? "Kaydet" : "Varlık Ekle")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
