import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Screen, T } from '@/components/ui';
import { resolveUpc } from '@/lib/api';
import { colors, space } from '@/lib/theme';

/** Barcode scan: UPC/EAN -> catalog product, or send to review. */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  async function onScanned(result: BarcodeScanningResult) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await resolveUpc(result.data);
      if (r.kind === 'found') {
        router.replace({ pathname: '/add-watch', params: { productId: r.productId } });
        return;
      }
      setMessage(r.message);
    } catch {
      setMessage('Could not look up that barcode. Check your connection and try again.');
    }
    setTimeout(() => (busy.current = false), 2000);
  }

  if (!permission) return <Screen />;

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.center}>
          <T variant="title" style={{ textAlign: 'center' }}>
            Camera access needed
          </T>
          <T variant="muted" style={{ textAlign: 'center' }}>
            Brazier uses the camera only to read barcodes. You can also search or paste a product
            link instead.
          </T>
          {permission.canAskAgain ? (
            <Button label="Allow camera" onPress={requestPermission} />
          ) : (
            <T variant="muted">Turn on camera access for Brazier in Settings.</T>
          )}
          <Button label="Search instead" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['upc_a', 'upc_e', 'ean13', 'ean8'] }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <T style={{ color: '#fff', textAlign: 'center' }}>Point at the barcode on the box</T>
        {message ? (
          <T testID="scan-message" style={{ color: colors.warn, textAlign: 'center' }}>
            {message}
          </T>
        ) : null}
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
  overlay: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg },
  frame: { height: 180, borderWidth: 2, borderColor: colors.accent, borderRadius: 12 },
});
