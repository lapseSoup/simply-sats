// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsNetwork } from './SettingsNetwork'
import * as config from '../../../services/config'

const mockShowToast = vi.fn()

vi.mock('../../../services/config', () => ({
  getNetwork: vi.fn().mockReturnValue('mainnet'),
  setNetwork: vi.fn(),
}))
vi.mock('../../../contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}))

describe('SettingsNetwork', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows current network as mainnet by default', () => {
    render(<SettingsNetwork />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('mainnet')
  })

  it('calls setNetwork when switching to testnet', () => {
    render(<SettingsNetwork />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'testnet' } })
    expect(config.setNetwork).toHaveBeenCalledWith('testnet')
  })

  it('renders warning banner when testnet is selected', () => {
    vi.mocked(config.getNetwork).mockReturnValue('testnet')
    render(<SettingsNetwork />)
    expect(screen.getByText(/Testnet coins have no real value/i)).toBeInTheDocument()
  })

  it('calls showToast when network changes', () => {
    render(<SettingsNetwork />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'testnet' } })
    expect(mockShowToast).toHaveBeenCalledWith(
      'Switched to Testnet — restart to apply changes',
      'success'
    )
  })
})
