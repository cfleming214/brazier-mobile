import { formatCents, parsePriceToCents, type RetailerSlug } from '@drophawk/shared';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Button, Panel, Screen, T } from '@/components/ui';
import { resolveUrl, type ProductSearchResult } from '@/lib/api';
import { retailerNames, WATCHABLE_RETAILERS } from '@/lib/format';
import { useCreateWatch, useProduct, useProductSearch } from '@/lib/queries';
import { colors, fonts, radius, space } from '@/lib/theme';

/** Add Watch: find a product (search, paste a link or scan), then choose retailers and filters. */
export default function AddWatch() {
  const params = useLocalSearchParams<{ productId?: string; retailer?: string }>();
  const [productId, setProductId] = useState<string | null>(params.productId ?? null);
  return (
    <Screen>
      <View style={styles.header}>
        <T variant="display">ADD WATCH</T>
        <Pressable
          accessibilityRole="button"
          testID="close-add-watch"
          onPress={() => router.back()}
        >
          <T variant="mono" style={{ color: colors.accent }}>
            CLOSE
          </T>
        </Pressable>
      </View>
      {productId ? (
        <Configure
          productId={productId}
          preferredRetailer={params.retailer as RetailerSlug | undefined}
          onBack={() => setProductId(null)}
        />
      ) : (
        <Find onPick={setProductId} />
      )}
    </Screen>
  );
}

function Find({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const { data: results = [], isFetching } = useProductSearch(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  async function handleLink(text: string) {
    setResolving(true);
    setMessage(null);
    try {
      const r = await resolveUrl(text);
      if (r.kind === 'found') onPick(r.productId);
      else setMessage(r.message);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setResolving(false);
    }
  }

  const looksLikeLink = /https?:\/\/|\.(com|net)\//i.test(q);

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <TextInput
        testID="search-input"
        value={q}
        onChangeText={(t) => {
          setQ(t);
          setMessage(null);
        }}
        placeholder="Search products or paste a link"
        placeholderTextColor={colors.muted}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        onSubmitEditing={() => looksLikeLink && handleLink(q)}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button
            testID="paste-link"
            variant="ghost"
            label="Paste link"
            loading={resolving}
            onPress={async () => {
              const text = await Clipboard.getStringAsync();
              if (!text) return setMessage('Your clipboard is empty. Copy a product link first.');
              setQ(text);
              handleLink(text);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="scan-barcode"
            variant="ghost"
            label="Scan barcode"
            onPress={() => router.push('/scan')}
          />
        </View>
      </View>

      {looksLikeLink ? (
        <Button
          testID="use-link"
          label="Use this link"
          loading={resolving}
          onPress={() => handleLink(q)}
        />
      ) : null}

      {message ? (
        <T testID="add-watch-message" variant="muted" style={{ color: colors.warn }}>
          {message}
        </T>
      ) : null}

      {!looksLikeLink && debounced.length >= 2 ? (
        <Panel
          title={
            isFetching ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`
          }
        >
          {results.length === 0 && !isFetching ? (
            <T variant="muted">No matches. Try fewer words, or paste the product link.</T>
          ) : (
            results.map((p, i) => (
              <ResultRow key={p.id} p={p} index={i} onPress={() => onPick(p.id)} />
            ))
          )}
        </Panel>
      ) : null}
    </ScrollView>
  );
}

function ResultRow({
  p,
  index,
  onPress,
}: {
  p: ProductSearchResult;
  index: number;
  onPress: () => void;
}) {
  const watchable = p.retailer_ids.filter((r) => WATCHABLE_RETAILERS.includes(r));
  return (
    <Pressable
      testID={`search-result-${index}`}
      onPress={onPress}
      style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.panel2 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: fonts.bodySemi }}>{p.name}</T>
        <T variant="mono" style={{ color: colors.muted, fontSize: 10 }}>
          {[
            p.set_name,
            formatCents(p.msrp_cents),
            `${watchable.length} retailer${watchable.length === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
      </View>
      <T style={{ color: colors.accent }}>›</T>
    </Pressable>
  );
}

function Configure({
  productId,
  preferredRetailer,
  onBack,
}: {
  productId: string;
  preferredRetailer?: RetailerSlug;
  onBack: () => void;
}) {
  const { data: product, isLoading } = useProduct(productId);
  const create = useCreateWatch();
  const carried = useMemo(
    () =>
      ((product?.retailer_skus ?? []) as { retailer_id: RetailerSlug }[])
        .map((r) => r.retailer_id)
        .filter((r, i, a) => WATCHABLE_RETAILERS.includes(r) && a.indexOf(r) === i),
    [product],
  );
  const [selected, setSelected] = useState<RetailerSlug[] | null>(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [marketplace, setMarketplace] = useState(false);
  const [radius, setRadius] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chosen =
    selected ?? (preferredRetailer && carried.includes(preferredRetailer) ? carried : carried);

  if (isLoading || !product) {
    return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.accent} />;
  }

  async function save() {
    setError(null);
    const maxPriceCents = maxPrice.trim() ? parsePriceToCents(maxPrice) : null;
    if (maxPrice.trim() && (maxPriceCents == null || maxPriceCents <= 0))
      return setError('Enter a max price like 65 or 64.99.');
    const radiusKm = radius.trim() ? Number(radius) : null;
    if (radius.trim() && (!Number.isFinite(radiusKm) || radiusKm! <= 0 || radiusKm! > 500))
      return setError('Pickup radius must be between 1 and 500 km.');
    if (chosen.length === 0) return setError('Pick at least one retailer.');
    try {
      const { id } = await create.mutateAsync({
        productId,
        retailerIds: chosen,
        maxPriceCents,
        includeMarketplace: marketplace,
        pickupRadiusKm: radiusKm,
      });
      router.dismissTo('/');
      router.push(`/watch/${id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg.includes('duplicate')
          ? 'You already watch this product.'
          : 'Could not save the watch. Try again.',
      );
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Panel>
        <T testID="configure-product-name" style={{ fontFamily: fonts.bodySemi, fontSize: 16 }}>
          {product.name}
        </T>
        <T variant="mono" style={{ color: colors.muted }}>
          {[product.set_name, formatCents(product.msrp_cents) + ' MSRP']
            .filter(Boolean)
            .join(' · ')}
        </T>
      </Panel>

      <Panel title="Retailers">
        {carried.length === 0 ? (
          <T variant="muted">
            No launch retailer carries this yet. We'll add retailers as listings appear.
          </T>
        ) : (
          <View style={styles.chips}>
            {carried.map((r) => {
              const on = chosen.includes(r);
              return (
                <Pressable
                  key={r}
                  testID={`retailer-${r}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setSelected(on ? chosen.filter((x) => x !== r) : [...chosen, r])}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <T
                    style={{
                      color: on ? colors.accentInk : colors.ink,
                      fontFamily: fonts.bodyMedium,
                      fontSize: 13,
                    }}
                  >
                    {retailerNames[r]}
                  </T>
                </Pressable>
              );
            })}
          </View>
        )}
      </Panel>

      <Panel title="Filters">
        <T variant="label">Max price</T>
        <TextInput
          testID="max-price"
          value={maxPrice}
          onChangeText={setMaxPrice}
          placeholder={
            product.msrp_cents ? `e.g. ${(product.msrp_cents / 100 + 5).toFixed(0)}` : 'Any price'
          }
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <T>Include marketplace sellers</T>
            <T variant="muted" style={{ fontSize: 12 }}>
              Third-party sellers often charge resale prices.
            </T>
          </View>
          <Switch
            testID="include-marketplace"
            value={marketplace}
            onValueChange={setMarketplace}
            trackColor={{ true: colors.accent, false: colors.line }}
          />
        </View>
        <T variant="label">Store pickup radius (km)</T>
        <TextInput
          testID="pickup-radius"
          value={radius}
          onChangeText={setRadius}
          placeholder="Shipping only"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          style={styles.input}
        />
      </Panel>

      {error ? (
        <T testID="configure-error" style={{ color: colors.dead }}>
          {error}
        </T>
      ) : null}
      <Button
        testID="save-watch"
        label={`Watch at ${chosen.length} retailer${chosen.length === 1 ? '' : 's'}`}
        loading={create.isPending}
        onPress={save}
        disabled={carried.length === 0}
      />
      <Button label="Choose a different product" variant="ghost" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  body: { padding: space.lg, gap: space.md, paddingBottom: 64 },
  row: { flexDirection: 'row', gap: space.sm },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: space.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
});
