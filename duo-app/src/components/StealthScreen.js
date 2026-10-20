import { View, Text, StyleSheet, StatusBar } from "react-native";
import { colors, radius, spacing } from "../theme";

// Pantalla discreta: si está activada en "Nosotros › Privacidad", esta vista
// tapa TODO lo que se ve en la app en cuanto sale a segundo plano (lista de
// aplicaciones recientes, capturas del sistema, alguien mirando por encima).
// Vuelve sola a la app real al volver a primer plano.

const FAKE_NOTES = [
  { t: "Compra", d: "leche, pan, café" },
  { t: "Ideas", d: "poner la lavadora mañana temprano" },
  { t: "Lista", d: "llamar al banco · recoger el paquete" },
  { t: "Recordatorio", d: "factura del móvil: día 25" },
];

export default function StealthScreen() {
  return (
    <View style={styles.wrap}>
      <StatusBar style="dark" />
      <View style={styles.bar}>
        <Text style={styles.barTitle}>Notas</Text>
        <Text style={styles.barIcon}>✎</Text>
      </View>
      {FAKE_NOTES.map((n) => (
        <View key={n.t} style={styles.note}>
          <Text style={styles.noteT}>{n.t}</Text>
          <Text style={styles.noteD} numberOfLines={1}>
            {n.d}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#F5F2EA",
    paddingTop: 48,
  },
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  barTitle: { fontSize: 28, fontWeight: "800", color: "#2B2B2B" },
  barIcon: { fontSize: 22, color: "#2B2B2B" },
  note: {
    backgroundColor: "#FFFDF6",
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#E6E0D2",
  },
  noteT: { fontSize: 15, fontWeight: "700", color: "#2B2B2B" },
  noteD: { fontSize: 13, color: "#6B675E", marginTop: 2 },
});
