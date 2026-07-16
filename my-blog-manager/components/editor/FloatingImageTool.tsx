'use client';

import MediaPicker from '../manager/MediaPicker';

interface FloatingImageToolProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string) => void;
}

export default function FloatingImageTool({ isOpen, onClose, onInsert }: FloatingImageToolProps) {
  return <MediaPicker open={isOpen} onClose={onClose} onSelect={(url) => onInsert(url)} />;
}
