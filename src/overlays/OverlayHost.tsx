import { BluetoothMenu } from '@/components/BluetoothMenu'
import { DebugScreen } from '@/components/DebugScreen'
import { OutputPicker } from '@/components/OutputPicker'
import { PairingDialog } from '@/components/PairingDialog'
import { PowerMenu } from '@/components/PowerMenu'
import { ReportDialog } from '@/components/ReportDialog'
import { Screensaver } from '@/components/Screensaver'
import { SettingsSheet } from '@/components/SettingsSheet'
import { VolumeOverlay } from '@/components/VolumeOverlay'
import type { VolumeOverlayState } from '@/hooks/useHardwareButtons'
import type { PairingPrompt } from '@/hooks/useBluetooth'
import type { ConnectDevice } from '@/api/types'
import { useOverlayState } from './overlayContext'

export interface OverlayHostProps {
  volumeOverlay: VolumeOverlayState
  /** the phone owns the volume, so the sheet says so instead of offering a slider */
  phoneVolume: boolean
  online: boolean | null
  connectDevices: ConnectDevice[]
  onPickDevice: (device: ConnectDevice) => void
  // issue #92: the Standard-Gerät star in the "Ausgabegeräte" modal persists
  // settings.defaultDeviceId; the player's #79 prompt reads it back
  defaultDeviceId: string | null
  onSetDefault: (deviceId: string) => void
  pairing: PairingPrompt | null
  screensaverArt: string | null
  utcOffsetMin: number | null
}

/**
 * Every overlay that can cover any screen, rendered once. Which of them are up
 * is `useOverlays`' business; this only draws them.
 */
export function OverlayHost({
  volumeOverlay,
  phoneVolume,
  online,
  connectDevices,
  onPickDevice,
  defaultDeviceId,
  onSetDefault,
  pairing,
  screensaverArt,
  utcOffsetMin,
}: OverlayHostProps) {
  const overlays = useOverlayState()

  return (
    <>
      <VolumeOverlay state={volumeOverlay} />
      <PowerMenu open={overlays.isOpen('powerMenu')} onClose={() => overlays.close('powerMenu')} />
      <SettingsSheet
        open={overlays.isOpen('settings')}
        onClose={() => overlays.close('settings')}
        phoneVolume={phoneVolume}
      />
      {overlays.isOpen('outputs') ? (
        <OutputPicker
          devices={connectDevices}
          currentDefaultId={defaultDeviceId}
          onSelect={onPickDevice}
          onSetDefault={onSetDefault}
          onClose={() => overlays.close('outputs')}
        />
      ) : null}
      {overlays.isOpen('btMenu') ? (
        <BluetoothMenu online={online} onClose={() => overlays.close('btMenu')} />
      ) : null}
      <DebugScreen
        open={overlays.isOpen('debug')}
        onClose={() => overlays.close('debug')}
        onReport={overlays.openReport}
      />
      {pairing ? <PairingDialog passkey={pairing.passkey} address={pairing.address} /> : null}
      {overlays.reportId ? (
        <ReportDialog id={overlays.reportId} onDismiss={() => overlays.close('report')} />
      ) : null}
      {overlays.isOpen('screensaver') ? (
        <Screensaver
          artUrl={screensaverArt}
          utcOffsetMin={utcOffsetMin}
          onClose={() => overlays.close('screensaver')}
        />
      ) : null}
    </>
  )
}
