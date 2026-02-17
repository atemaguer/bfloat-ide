/**
 * Projects API
 * 
 * This module handles fetching projects from the backend.
 * Currently uses mock data, but can be easily updated to use a real API.
 */

export interface Project {
  id: string
  name: string
  isLocal: boolean
  lastOpened?: string
}

// TODO: Replace with actual API base URL from environment variables
// const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

/**
 * Fetches all projects from the backend
 * 
 * @returns Promise resolving to an array of projects
 */
export async function fetchProjects(): Promise<Project[]> {
  // TODO: Replace with actual API call
  // Example implementation:
  // const response = await fetch(`${API_BASE_URL}/api/projects`)
  // if (!response.ok) {
  //   throw new Error('Failed to fetch projects')
  // }
  // return response.json()
  
  // Mock implementation for now
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: '1', name: 'bfloat-todo-app', isLocal: true, lastOpened: '2024-01-15' },
        { id: '2', name: 'neural-network-viz', isLocal: true, lastOpened: '2024-01-14' },
        { id: '3', name: 'api-dashboard', isLocal: false, lastOpened: '2024-01-13' },
        { id: '4', name: 'react-portfolio', isLocal: true, lastOpened: '2024-01-12' },
        { id: '5', name: 'node-backend', isLocal: false, lastOpened: '2024-01-11' },
        { id: '6', name: 'mobile-app', isLocal: true, lastOpened: '2024-01-10' },
      ])
    }, 300) // Simulate network delay
  })
}

