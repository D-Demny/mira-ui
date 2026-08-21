import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NavigationProvider, useNavigation } from '@/navigation/navigationContext'

const wrapper = ({ children }: { children: ReactNode }) => (
  <NavigationProvider>{children}</NavigationProvider>
)

describe('NavigationProvider', () => {
  it('popRoute returns the popped route synchronously', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => {
      result.current.pushRoute('playlists')
    })
    let popped: string | null = null
    act(() => {
      popped = result.current.popRoute()
    })
    expect(popped).toBe('playlists')
    expect(result.current.state.navigationStack).toEqual([])
    expect(result.current.state.currentRoute).toBe('library')
  })

  it('popRoute pops to the previous route on a deeper stack', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => {
      result.current.pushRoute('playlists')
    })
    act(() => {
      result.current.pushRoute('home')
    })
    let popped: string | null = null
    act(() => {
      popped = result.current.popRoute()
    })
    expect(popped).toBe('home')
    expect(result.current.state.navigationStack).toEqual(['playlists'])
    expect(result.current.state.currentRoute).toBe('playlists')
  })

  it('popRoute returns null at the root', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    let popped: string | null = 'sentinel'
    act(() => {
      popped = result.current.popRoute()
    })
    expect(popped).toBeNull()
    expect(result.current.state.navigationStack).toEqual([])
  })

  it('pushRoute updates currentRoute and the stack', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => {
      result.current.pushRoute('home')
    })
    expect(result.current.state.navigationStack).toEqual(['home'])
    expect(result.current.state.currentRoute).toBe('home')
  })

  it('tracks the last browse route for the back hierarchy', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })

    act(() => {
      result.current.setLastBrowseRoute('playlists')
    })
    let target: string | null = 'sentinel'
    act(() => {
      target = result.current.goBackFromPlaying()
    })
    expect(target).toBe('playlists')

    act(() => {
      result.current.clearLastBrowseRoute()
    })
    act(() => {
      target = result.current.goBackFromPlaying()
    })
    expect(target).toBeNull()
  })

  it('resetStack clears the stack and the current route', () => {
    const { result } = renderHook(() => useNavigation(), { wrapper })
    act(() => {
      result.current.pushRoute('playlists')
    })
    act(() => {
      result.current.pushRoute('home')
    })

    act(() => {
      result.current.resetStack()
    })

    expect(result.current.state.navigationStack).toEqual([])
    expect(result.current.state.currentRoute).toBeNull()
  })
})
