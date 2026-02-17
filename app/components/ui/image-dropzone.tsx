import { useRef } from 'react'
import { Button } from './button'

interface ImageDropzoneProps {
  imageUrl?: string
  onImageChange: (file: File | null) => void
  label: string
  helpText: string
  maxSize?: string
}

export function ImageDropzone({ imageUrl, onImageChange, label, helpText, maxSize }: ImageDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      onImageChange(file)
    }
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="image-dropzone">
      <label className="image-dropzone-label">{label}</label>
      <div className="image-dropzone-content">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <div className="image-dropzone-preview">
          {imageUrl ? (
            <img src={imageUrl} alt={`${label} Icon`} className="image-dropzone-img" />
          ) : (
            <div className="image-dropzone-placeholder" />
          )}
        </div>
        <div className="image-dropzone-actions">
          <Button
            type="button"
            onClick={handleClick}
            className="image-dropzone-button"
          >
            Change icon
          </Button>
          <span className="image-dropzone-hint">Click to upload</span>
        </div>
      </div>
      {maxSize && (
        <div className="image-dropzone-help">
          {maxSize} max {helpText}
        </div>
      )}
    </div>
  )
}
