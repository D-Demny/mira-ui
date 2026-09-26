import { BluetoothMenu } from '@/components/BluetoothMenu'
import { DebugScreen } from '@/components/DebugScreen'
import { DevicePicker } from '@/components/DevicePicker'
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
  pairing,
  screensaverArt,
  utcOffsetMin,
}: OverlayHostProps) {
  const overlays = useOverlayState()

  return (
    <>
      <VolumeOverlay state={volumeOverlay} />
      <PowerMenu
        open={overlays.isOpen('powerMenu')}
        onClose={() => overlays.close('powerMenu')}
      />
      <SettingsSheet
        open={overlays.isOpen('settings')}
        onClose={() => overlays.close('settings')}
        phoneVolume={phoneVolume}
      />
      {overlays.isOpen('deviceMenu') ? (
        <DevicePicker
          devices={connectDevices}
          onSelect={onPickDevice}
          placement="modal"
          onClose={() => overlays.close('deviceMenu')}
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
