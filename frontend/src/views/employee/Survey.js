import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft,
  MapPin,
  Camera,
  Navigation,
  CheckCircle,
  AlertTriangle,
  User,
  Phone,
  Send,
  Flag,
  Loader2,
  Lock,
  XCircle,
  RotateCcw,
  ExternalLink,
  Home,
  Building,
  Droplet,
  ArrowRight
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

// Function to add watermark to image with GPS, Date, Time
// Fixed for mobile camera images with EXIF orientation handling
// OPTIMIZED COMPRESSION - Fast upload with decent quality
const addWatermarkToImage = (file, latitude, longitude) => {
  return new Promise((resolve, reject) => {
    // Create an image element to load the file
    const img = new Image();
    
    // Handle image load
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // OPTIMIZED: Limit max dimension to 800px for fast upload
        const MAX_SIZE = 800;
        let width = img.width;
        let height = img.height;
        
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          } else {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }
        
        // Set canvas size to compressed dimensions
        canvas.width = width;
        canvas.height = height;
        
        // Draw the original image (scaled)
        ctx.drawImage(img, 0, 0, width, height);
        
        // Create watermark text
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const timeStr = now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        
        const watermarkText = `GPS: ${latitude?.toFixed(6) || 'N/A'}, ${longitude?.toFixed(6) || 'N/A'} | ${dateStr} ${timeStr}`;
        
        // Calculate font size based on image dimensions (responsive)
        const fontSize = Math.max(14, Math.min(width, height) * 0.025);
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        
        const textWidth = ctx.measureText(watermarkText).width;
        const padding = 10;
        const x = width - textWidth - padding;
        const y = height - padding;
        
        // Draw background rectangle for better visibility
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - 8, y - fontSize - 4, textWidth + 16, fontSize + 12);
        
        // Draw watermark text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(watermarkText, x, y);
        
        // Also add a smaller watermark at top-left for extra visibility
        const smallFontSize = Math.max(10, fontSize * 0.7);
        ctx.font = `bold ${smallFontSize}px Arial, sans-serif`;
        const topText = `📍 ${latitude?.toFixed(4) || 'N/A'}, ${longitude?.toFixed(4) || 'N/A'}`;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(8, 8, ctx.measureText(topText).width + 16, smallFontSize + 12);
        ctx.fillStyle = '#00ff00';
        ctx.fillText(topText, 16, 8 + smallFontSize + 2);
        
        // Convert canvas to blob with OPTIMIZED COMPRESSION (0.55 quality = ~80-150KB typical)
        canvas.toBlob((blob) => {
          if (blob) {
            const watermarkedFile = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const sizeKB = (watermarkedFile.size / 1024).toFixed(0);
            console.log(`📸 Compressed: ${watermarkedFile.name} - ${sizeKB}KB`);
            
            // If still too large (over 200KB), try more compression
            if (watermarkedFile.size > 200 * 1024) {
              canvas.toBlob((smallerBlob) => {
                if (smallerBlob) {
                  const smallerFile = new File([smallerBlob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
                  console.log(`📸 Extra compressed: ${(smallerFile.size / 1024).toFixed(0)}KB`);
                  resolve(smallerFile);
                } else {
                  resolve(watermarkedFile);
                }
              }, 'image/jpeg', 0.4); // More aggressive if still too big
            } else {
              resolve(watermarkedFile);
            }
          } else {
            console.warn('Canvas toBlob returned null, using original file');
            resolve(file);
          }
        }, 'image/jpeg', 0.55); // 0.55 quality - good enough for survey, fast upload
      } catch (err) {
        console.error('Error applying watermark:', err);
        resolve(file);
      }
    };
    
    img.onerror = (err) => {
      console.error('Error loading image for watermark:', err);
      resolve(file);
    };
    
    // Use createObjectURL for better mobile compatibility
    img.src = URL.createObjectURL(file);
  });
};

// Convert dataURL to Blob
const dataURLtoBlob = (dataURL) => {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

const RELATION_OPTIONS = [
  'Self',
  'Family Member',
  'Kirayedar',
  'Padosi',
  'Worker',
  'Other'
];

// Calculate distance between two GPS coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Helper: sessionStorage keys for survey state persistence (survives mobile camera return)
const SURVEY_STORAGE_KEY = (pid) => `survey_state_${pid}`;
const SURVEY_PHOTO_KEY = (pid, type) => `survey_photo_${pid}_${type}`;

// Save survey form state to sessionStorage
const saveSurveyState = (pid, state) => {
  try { sessionStorage.setItem(SURVEY_STORAGE_KEY(pid), JSON.stringify(state)); } catch(e) { /* quota */ }
};

// Load survey form state from sessionStorage
const loadSurveyState = (pid) => {
  try {
    const saved = sessionStorage.getItem(SURVEY_STORAGE_KEY(pid));
    return saved ? JSON.parse(saved) : null;
  } catch(e) { return null; }
};

// Save photo preview as dataURL to sessionStorage (compressed photos are small enough)
const savePhotoPreview = (pid, type, dataUrl) => {
  try { sessionStorage.setItem(SURVEY_PHOTO_KEY(pid, type), dataUrl); } catch(e) { /* quota */ }
};

// Load photo preview from sessionStorage
const loadPhotoPreview = (pid, type) => {
  try { return sessionStorage.getItem(SURVEY_PHOTO_KEY(pid, type)); } catch(e) { return null; }
};

// Convert a base64 dataURL back to a File object
const dataURLtoFile = (dataUrl, filename) => {
  try {
    const blob = dataURLtoBlob(dataUrl);
    return new File([blob], filename, { type: blob.type });
  } catch(e) { return null; }
};

export default function Survey() {
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const { token, user: authUser } = useAuth();
  // Admin can turn the 50 m geofence off per surveyor (gps_radius_required=false => office/remote submission)
  const radiusRequired = authUser?.gps_radius_required !== false;

  const [property, setProperty] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingPhoto, setProcessingPhoto] = useState(null);

  // GPS State
  const [gpsStatus, setGpsStatus] = useState('idle');
  const [location, setLocation] = useState({ latitude: null, longitude: null });

  // Attendance check state
  const [attendanceMarked, setAttendanceMarked] = useState(false);
  const [checkingAttendance, setCheckingAttendance] = useState(true);

  // Restore form state from sessionStorage on mount (survives mobile camera return)
  const savedState = loadSurveyState(propertyId);

  // Form State - Simplified (removed correct_colony_name)
  const [formData, setFormData] = useState(() => savedState?.formData || {
    receiver_name: '',
    receiver_mobile: '',
    relation: '',
    remarks: '',
    self_satisfied: 'yes'
  });

  // Self Certification status for non-self-certified properties
  const [selfCertStatus, setSelfCertStatus] = useState(() => savedState?.selfCertStatus || '');
  
  // Self Certification OTP state (when selfCertStatus = 'done')
  const [selfCertOtp, setSelfCertOtp] = useState('');
  const [selfCertMobile, setSelfCertMobile] = useState('');

  // Special submission conditions - allows bypassing required fields
  const [specialCondition, setSpecialCondition] = useState(() => savedState?.specialCondition || '');
  const [houseStatus, setHouseStatus] = useState(() => savedState?.houseStatus || '');
  const [propertyUse, setPropertyUse] = useState(() => savedState?.propertyUse || '');
  const [propertyUseRemarks, setPropertyUseRemarks] = useState(() => savedState?.propertyUseRemarks || '');
  
  // 50m radius check
  const [withinRange, setWithinRange] = useState(null);
  const [distanceFromProperty, setDistanceFromProperty] = useState(null);

  // Photo State - Restore preview from sessionStorage if available
  const [housePhoto, setHousePhoto] = useState(() => {
    const saved = loadPhotoPreview(propertyId, 'house');
    return saved ? dataURLtoFile(saved, 'restored_house.jpg') : null;
  });
  const [housePhotoPreview, setHousePhotoPreview] = useState(() => loadPhotoPreview(propertyId, 'house'));
  const [receiverPhoto, setReceiverPhoto] = useState(() => {
    const saved = loadPhotoPreview(propertyId, 'receiver');
    return saved ? dataURLtoFile(saved, 'restored_receiver.jpg') : null;
  });
  const [receiverPhotoPreview, setReceiverPhotoPreview] = useState(() => loadPhotoPreview(propertyId, 'receiver'));

  // File input refs
  const houseCameraRef = useRef(null);
  const receiverCameraRef = useRef(null);

  // Check if special condition allows skipping required fields (but NOT photo)
  const canSkipRequiredFields = specialCondition === 'property_locked' || specialCondition === 'owner_denied' || specialCondition === 'vacant_plot' || specialCondition === 'wrong_location';

  // Use ref to track if property was already loaded (prevents re-fetch on camera return)
  const propertyLoadedRef = useRef(false);

  // Persist form state to sessionStorage whenever it changes
  useEffect(() => {
    saveSurveyState(propertyId, {
      formData, selfCertStatus, specialCondition, houseStatus, propertyUse, propertyUseRemarks
    });
  }, [formData, selfCertStatus, specialCondition, houseStatus, propertyUse, propertyUseRemarks, propertyId]);

  useEffect(() => {
    if (!propertyLoadedRef.current) {
      fetchProperty();
      propertyLoadedRef.current = true;
    }
    getLocation();
    checkTodayAttendance();
  }, [propertyId]);

  // Check if attendance is marked for today
  const checkTodayAttendance = async () => {
    setCheckingAttendance(true);
    try {
      const response = await axios.get(`${API_URL}/employee/attendance/today`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAttendanceMarked(response.data.marked || false);
    } catch (error) {
      // If endpoint doesn't exist or error, assume attendance not required
      setAttendanceMarked(true);
    } finally {
      setCheckingAttendance(false);
    }
  };

  useEffect(() => {
    if (location.latitude && location.longitude && property?.latitude && property?.longitude) {
      const distance = calculateDistance(
        location.latitude,
        location.longitude,
        property.latitude,
        property.longitude
      );
      setDistanceFromProperty(Math.round(distance));
      setWithinRange(distance <= 50);
    }
  }, [location, property]);

  const fetchProperty = async () => {
    try {
      const response = await axios.get(`${API_URL}/employee/property/${propertyId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProperty(response.data.property);
      setSubmission(response.data.submission);

      // Check if property is self-certified - if yes, lock self_satisfied to 'yes'
      const isSelfCertified = response.data.property?.self_certified === true;

      if (response.data.submission) {
        const sub = response.data.submission;
        setFormData({
          receiver_name: sub.receiver_name || '',
          receiver_mobile: sub.receiver_mobile || '',
          relation: sub.relation || '',
          correct_colony_name: sub.correct_colony_name || '',
          remarks: sub.remarks || '',
          self_satisfied: isSelfCertified ? 'yes' : (sub.self_satisfied || 'yes')
        });
      } else if (isSelfCertified) {
        // Pre-set self_satisfied to 'yes' for self-certified properties
        setFormData(prev => ({ ...prev, self_satisfied: 'yes' }));
      }
    } catch (error) {
      // Don't navigate away on error - user might be returning from camera
      // Only show error if property was never loaded before
      if (!property) {
        toast.error('Failed to load property. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getLocation = () => {
    setGpsStatus('loading');
    if (!navigator.geolocation) {
      setGpsStatus('error');
      toast.error('GPS not supported on this device');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setGpsStatus('success');
        toast.success('GPS location captured!');
      },
      (error) => {
        setGpsStatus('error');
        toast.error('Failed to get GPS. Please enable location services.');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const handlePhotoCapture = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Prevent any form submission or navigation during photo processing
    e.preventDefault?.();
    e.stopPropagation?.();

    setProcessingPhoto(type);
    console.log('Photo captured, file:', file.name, file.size, file.type);

    try {
      // For mobile: try to get fresh GPS location if not available
      let lat = location.latitude;
      let lng = location.longitude;
      
      if (!lat || !lng) {
        console.log('GPS not available, attempting to fetch...');
        // Try to get GPS one more time
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            });
          });
          lat = position.coords.latitude;
          lng = position.coords.longitude;
          console.log('GPS fetched for watermark:', lat, lng);
        } catch (gpsErr) {
          console.warn('Could not get GPS for watermark:', gpsErr);
        }
      }

      if (lat && lng) {
        console.log('Applying watermark with GPS:', lat, lng);
        const watermarkedFile = await addWatermarkToImage(file, lat, lng);
        if (type === 'house') {
          setHousePhoto(watermarkedFile);
          const previewUrl = URL.createObjectURL(watermarkedFile);
          setHousePhotoPreview(previewUrl);
          // Save photo preview as dataURL to sessionStorage for camera-return recovery
          const reader = new FileReader();
          reader.onload = () => savePhotoPreview(propertyId, 'house', reader.result);
          reader.readAsDataURL(watermarkedFile);
        } else if (type === 'receiver') {
          setReceiverPhoto(watermarkedFile);
          const previewUrl = URL.createObjectURL(watermarkedFile);
          setReceiverPhotoPreview(previewUrl);
          const reader = new FileReader();
          reader.onload = () => savePhotoPreview(propertyId, 'receiver', reader.result);
          reader.readAsDataURL(watermarkedFile);
        }
        toast.success('Photo captured with GPS & timestamp watermark!');
      } else {
        console.warn('No GPS available for watermark');
        if (type === 'house') {
          setHousePhoto(file);
          const previewUrl = URL.createObjectURL(file);
          setHousePhotoPreview(previewUrl);
          const reader = new FileReader();
          reader.onload = () => savePhotoPreview(propertyId, 'house', reader.result);
          reader.readAsDataURL(file);
        } else if (type === 'receiver') {
          setReceiverPhoto(file);
          const previewUrl = URL.createObjectURL(file);
          setReceiverPhotoPreview(previewUrl);
          const reader = new FileReader();
          reader.onload = () => savePhotoPreview(propertyId, 'receiver', reader.result);
          reader.readAsDataURL(file);
        }
        toast.warning('Photo captured (no GPS watermark - location not available)');
      }
    } catch (error) {
      console.error('Error processing photo:', error);
      toast.error('Error processing photo');
    } finally {
      setProcessingPhoto(null);
    }
  };

  const validateMobile = (mobile) => {
    return /^\d{10}$/.test(mobile);
  };

  const handleSubmit = async () => {
    // Check attendance first
    if (!attendanceMarked) {
      toast.error('Please mark your attendance before starting survey');
      return;
    }
    
    // Validations - GPS check still required
    if (radiusRequired && withinRange === false) {
      toast.error('You must be within 50 meters of the property to submit');
      return;
    }

    // If special condition is selected (Property Locked, Owner Denied, Vacant Plot, Wrong Location), skip other validations
    if (canSkipRequiredFields) {
      // Only GPS location is required for special conditions
      if (!location.latitude || !location.longitude) {
        toast.error('GPS location is required');
        return;
      }
      
      // Property Status is mandatory for ALL submissions including special conditions
      if (!houseStatus) {
        toast.error('Please select Property Status (Kachha/Pakka/Vacant Plot)');
        return;
      }
      
      // Property Current Use is mandatory
      if (!propertyUse) {
        toast.error('Please select Property Current Use');
        return;
      }
      
      // If Property Use is 'other', remarks are required
      if (propertyUse === 'other' && !propertyUseRemarks.trim()) {
        toast.error('Please enter remarks for Other property use');
        return;
      }
      
      // Remarks required for all special conditions (Property Locked, Owner Denied, Vacant Plot, Wrong Location)
      if (!formData.remarks?.trim()) {
        toast.error(`Remarks are required for ${
          specialCondition === 'property_locked' ? 'Property Locked' : 
          specialCondition === 'owner_denied' ? 'Owner Denied' : 
          specialCondition === 'vacant_plot' ? 'Vacant Plot' : 
          'Property ID Wrong Location'
        }`);
        return;
      }
    } else {
      // Normal validation for regular submissions
      if (!formData.receiver_name || !formData.relation) {
        toast.error('Receiver name and relation are required');
        return;
      }

      if (!formData.receiver_mobile || !validateMobile(formData.receiver_mobile)) {
        toast.error('Please enter a valid 10-digit receiver mobile number');
        return;
      }

      // For NON-self-certified properties, selfCertStatus is required
      if (property?.self_certified !== true) {
        if (!selfCertStatus) {
          toast.error('Please select self-certification status');
          return;
        }
      }
      
      // Property Status is mandatory for normal submissions
      if (!houseStatus) {
        toast.error('Please select Property Status (Kachha/Pakka/Vacant Plot)');
        return;
      }
      
      // Property Current Use is mandatory
      if (!propertyUse) {
        toast.error('Please select Property Current Use');
        return;
      }
      
      // If Property Use is 'other', remarks are required
      if (propertyUse === 'other' && !propertyUseRemarks.trim()) {
        toast.error('Please enter remarks for Other property use');
        return;
      }
    }

    // Photo is ALWAYS compulsory - even for special conditions
    if (!housePhoto) {
      toast.error('Property photo is required');
      return;
    }
    if (!receiverPhoto && specialCondition !== 'vacant_plot') {
      toast.error('Receiver photo is required');
      return;
    }

    setSubmitting(true);
    setUploadProgress(0);

    try {
      const formDataObj = new FormData();
      formDataObj.append('receiver_name', formData.receiver_name || (specialCondition === 'property_locked' ? 'Property Locked' : specialCondition === 'owner_denied' ? 'Owner Denied' : specialCondition === 'vacant_plot' ? 'Vacant Plot' : specialCondition === 'wrong_location' ? 'Wrong Location' : ''));
      formDataObj.append('receiver_mobile', formData.receiver_mobile || '');
      formDataObj.append('relation', formData.relation || (canSkipRequiredFields ? 'N/A' : ''));
      formDataObj.append('remarks', formData.remarks || ''); // Only user-entered remarks, no auto text
      formDataObj.append('special_condition', specialCondition || '');
      formDataObj.append('house_status', houseStatus || '');
      formDataObj.append('property_use', propertyUse || '');
      formDataObj.append('property_use_remarks', propertyUseRemarks || '');
      formDataObj.append('wrong_location', specialCondition === 'wrong_location' ? 'true' : 'false');
      formDataObj.append('latitude', location.latitude);
      formDataObj.append('longitude', location.longitude);
      
      // Self Certification data - No OTP fields
      if (property?.self_certified !== true) {
        formDataObj.append('self_cert_status', selfCertStatus || ''); // done, later, deny
        formDataObj.append('self_satisfied', selfCertStatus === 'done' ? 'yes' : 'no');
      } else {
        formDataObj.append('self_cert_status', 'already_certified');
        formDataObj.append('self_satisfied', 'yes'); // Self-certified properties are auto-satisfied
      }
      
      // Photo is compulsory - always append
      formDataObj.append('house_photo', housePhoto);
      
      // Receiver photo - compulsory except vacant_plot
      if (receiverPhoto) {
        formDataObj.append('receiver_photo', receiverPhoto);
      }
      
      formDataObj.append('authorization', `Bearer ${token}`);

      await axios.post(`${API_URL}/employee/submit/${propertyId}`, formDataObj, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percent);
        },
        timeout: 120000 // 2 min timeout for slow networks
      });

      toast.success('Survey submitted successfully!');
      // Clear sessionStorage after successful submission
      try {
        sessionStorage.removeItem(SURVEY_STORAGE_KEY(propertyId));
        sessionStorage.removeItem(SURVEY_PHOTO_KEY(propertyId, 'house'));
        sessionStorage.removeItem(SURVEY_PHOTO_KEY(propertyId, 'receiver'));
      } catch(e) { /* ignore */ }
      navigate('/employee/properties');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit survey');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFlag = async () => {
    const remarks = prompt('Please enter reason for flagging:');
    if (!remarks) return;

    try {
      const formDataObj = new FormData();
      formDataObj.append('remarks', remarks);
      formDataObj.append('authorization', `Bearer ${token}`);

      await axios.post(`${API_URL}/employee/flag/${propertyId}`, formDataObj, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      toast.success('Property flagged');
      navigate('/employee/properties');
    } catch (error) {
      toast.error('Failed to flag property');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isCompleted = property?.status === 'Completed';
  const isApproved = property?.status === 'Approved';
  const isLocked = property?.locked === true || isCompleted || isApproved;

  // If property is locked (Completed or Approved), show locked message
  if (isLocked && !submission) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-gradient-to-r from-slate-600 to-slate-700 text-white sticky top-0 z-30">
          <div className="flex items-center px-4 h-16">
            <button
              onClick={() => navigate('/employee/properties')}
              className="mr-3 text-white/80 hover:text-white"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <h1 className="font-heading font-semibold flex items-center gap-2">
                <Lock className="w-4 h-4" /> Survey Locked
              </h1>
              <p className="text-xs text-white/70">{property?.property_id} • {property?.owner_name}</p>
            </div>
          </div>
        </header>
        <div className="p-4 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-sm">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">
              {isApproved ? 'Survey Approved' : 'Survey Submitted'}
            </h2>
            <p className="text-slate-600 mb-4">
              {isApproved 
                ? 'This property survey has been approved. You cannot make changes.'
                : 'This property survey has been submitted and is pending approval. You cannot make changes.'}
            </p>
            <div className={`rounded-lg p-3 mb-4 ${isApproved ? 'bg-green-50' : 'bg-yellow-50'}`}>
              <p className={`text-sm font-medium ${isApproved ? 'text-green-700' : 'text-yellow-700'}`}>
                Status: {property?.status}
              </p>
            </div>
            <Button
              onClick={() => navigate('/employee/properties')}
              className="w-full bg-slate-800"
            >
              Go Back to Properties
            </Button>
            <Button
              onClick={() => navigate(`/employee/phed-survey/${propertyId}`)}
              className="w-full mt-3 text-white"
              style={{ background: 'var(--phed-blue, #1565C0)' }}
              data-testid="locked-phed-survey-btn"
            >
              <Droplet className="w-4 h-4 mr-2" /> Start PHED Water Bill Survey
            </Button>
            <p className="text-[11px] text-slate-400 mt-2">PHED survey is independent of this property survey.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      {/* Header with Serial Number */}
      <header className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0 z-30">
        <div className="flex items-center px-4 h-16">
          <button
            onClick={() => navigate('/employee/properties')}
            className="mr-3 text-white/80 hover:text-white"
            data-testid="back-btn"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-heading font-semibold">
                {isCompleted ? 'View Survey' : 'Survey Form'}
              </h1>
            </div>
            <p className="text-xs text-white/70">{property?.property_id} • {property?.owner_name}</p>
          </div>
          {!isCompleted && (
            <button onClick={handleFlag} className="text-white/80 hover:text-white p-2" data-testid="flag-btn">
              <Flag className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="p-4 space-y-4" data-testid="survey-form">
        {/* PHED Water Bill Survey entry (independent of property survey) */}
        <button
          onClick={() => navigate(`/employee/phed-survey/${propertyId}`)}
          className="w-full rounded-xl p-4 flex items-center justify-between text-white shadow-md hover:shadow-lg transition-shadow"
          style={{ background: 'linear-gradient(90deg,#1565C0,#00897B)' }}
          data-testid="phed-survey-entry-btn"
        >
          <span className="flex items-center gap-3 text-left">
            <Droplet className="w-6 h-6 shrink-0" />
            <span>
              <span className="block font-semibold">Water Bill Survey Update</span>
              <span className="block text-xs text-white/80">Verify PHED water/sewer connection for this property</span>
            </span>
          </span>
          <ArrowRight className="w-5 h-5 shrink-0" />
        </button>

        {/* Attendance Lock Screen */}
        {checkingAttendance ? (
          <Card className="border-2 border-blue-200">
            <CardContent className="py-8 text-center">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-blue-500 mb-2" />
              <p className="text-slate-600">Checking attendance status...</p>
            </CardContent>
          </Card>
        ) : !attendanceMarked && !isCompleted ? (
          <Card className="border-2 border-red-300 bg-red-50">
            <CardContent className="py-8 text-center">
              <Lock className="w-12 h-12 mx-auto text-red-500 mb-4" />
              <h3 className="text-lg font-bold text-red-700 mb-2">Survey Locked</h3>
              <p className="text-red-600 mb-4">Please mark your attendance before starting survey</p>
              <Button 
                onClick={() => navigate('/employee/attendance')}
                className="bg-red-600 hover:bg-red-700"
              >
                Mark Attendance
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
        {/* Property Info Card - Property ID BIG, Serial Number small */}
        <Card className="border-2 border-blue-200">
          <CardHeader className="pb-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-lg">
            <CardTitle className="text-sm font-mono uppercase tracking-wider">
              Property Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm pt-3">
            {/* Property ID - BIG and prominent */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
              <span className="text-blue-600 text-xs font-semibold">PROPERTY ID</span>
              <p className="text-2xl font-bold text-blue-700">{property?.property_id || '-'}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500 text-xs">Owner</span>
                <p className="font-medium">{property?.owner_name || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Mobile</span>
                <p className="font-mono">{property?.mobile || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Colony</span>
                <p className="font-medium">{property?.colony || property?.ward || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Category</span>
                <p className="font-medium">{property?.category || '-'}</p>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Total Area</span>
                <p className="font-medium">{property?.total_area || '-'}</p>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 text-xs">Address</span>
                <p className="font-medium text-xs">{property?.address || '-'}</p>
              </div>
            </div>
            {property?.latitude && property?.longitude && (
              <div className="pt-2 border-t">
                <span className="text-slate-500 text-xs">GPS Coordinates</span>
                <p className="font-mono text-xs">{property?.latitude?.toFixed(6)}, {property?.longitude?.toFixed(6)}</p>
              </div>
            )}
            {property?.photo_url && (
              <div className="pt-2 border-t" data-testid="old-property-photo">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-amber-700 text-xs font-semibold bg-amber-100 px-2 py-0.5 rounded">OLD PROPERTY IMAGE (Verify & Match)</span>
                </div>
                <img 
                  src={property.photo_url} 
                  alt="Old Property" 
                  className="mt-1 rounded-lg w-full max-h-48 object-cover border-2 border-amber-300 cursor-pointer"
                  onClick={() => window.open(property.photo_url, '_blank')}
                  onError={(e) => { 
                    e.target.style.display = 'none'; 
                    e.target.nextElementSibling && (e.target.nextElementSibling.style.display = 'block');
                  }}
                />
                <a 
                  href={property.photo_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{display: 'none'}}
                  className="block mt-1 text-xs text-blue-600 underline break-all bg-blue-50 p-2 rounded"
                >
                  View Old Photo (external link)
                </a>
                <p className="text-xs text-amber-600 mt-1 text-center">Match this image with current property and take NEW photo below</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* GPS Status */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  gpsStatus === 'success' ? 'bg-emerald-100' :
                  gpsStatus === 'error' ? 'bg-red-100' : 'bg-slate-100'
                }`}>
                  <MapPin className={`w-5 h-5 ${
                    gpsStatus === 'success' ? 'text-emerald-600' :
                    gpsStatus === 'error' ? 'text-red-600' : 'text-slate-500'
                  }`} />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {gpsStatus === 'loading' ? 'Getting location...' :
                     gpsStatus === 'success' ? 'Location captured' :
                     gpsStatus === 'error' ? 'Location failed' : 'GPS Status'}
                  </p>
                  {gpsStatus === 'success' && (
                    <p className="text-xs text-slate-500 font-mono">
                      {location.latitude?.toFixed(6)}, {location.longitude?.toFixed(6)}
                    </p>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={getLocation} disabled={gpsStatus === 'loading'}>
                <Navigation className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>

            {/* Distance Check */}
            {!radiusRequired && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50" data-testid="radius-not-required-note">
                <p className="text-sm font-medium text-amber-700">50 m radius check not required for your account</p>
                <p className="text-xs text-slate-600">
                  You may submit from anywhere{distanceFromProperty !== null ? ` (currently ${distanceFromProperty}m from property)` : ''}.
                </p>
              </div>
            )}
            {radiusRequired && property?.latitude && property?.longitude && distanceFromProperty !== null && (
              <div className={`mt-3 p-3 rounded-lg ${withinRange ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <div className="flex items-center gap-2">
                  {withinRange ? (
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                  )}
                  <div>
                    <p className={`text-sm font-medium ${withinRange ? 'text-emerald-700' : 'text-red-700'}`}>
                      {withinRange ? 'Within range' : 'Out of range'} - {distanceFromProperty}m from property
                    </p>
                    <p className="text-xs text-slate-600">
                      {withinRange ? 'You can submit the survey' : 'Move closer to the property (within 50m)'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {!isCompleted && (
          <>
            {/* Special Conditions - Property Locked / Owner Denied / Vacant Plot */}
            <Card className="border-2 border-amber-200 bg-amber-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="w-4 h-4" />
                  Special Conditions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-amber-700">
                  Select if you cannot complete normal survey due to one of these conditions:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSpecialCondition(specialCondition === 'property_locked' ? '' : 'property_locked')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      specialCondition === 'property_locked'
                        ? 'border-amber-500 bg-amber-100 text-amber-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300'
                    }`}
                    data-testid="property-locked-btn"
                  >
                    <Lock className={`w-5 h-5 ${specialCondition === 'property_locked' ? 'text-amber-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Property Locked</span>
                    {specialCondition === 'property_locked' && (
                      <CheckCircle className="w-3 h-3 text-amber-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecialCondition(specialCondition === 'owner_denied' ? '' : 'owner_denied')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      specialCondition === 'owner_denied'
                        ? 'border-red-500 bg-red-100 text-red-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-red-300'
                    }`}
                    data-testid="owner-denied-btn"
                  >
                    <XCircle className={`w-5 h-5 ${specialCondition === 'owner_denied' ? 'text-red-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Owner Denied</span>
                    {specialCondition === 'owner_denied' && (
                      <CheckCircle className="w-3 h-3 text-red-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecialCondition(specialCondition === 'vacant_plot' ? '' : 'vacant_plot')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      specialCondition === 'vacant_plot'
                        ? 'border-blue-500 bg-blue-100 text-blue-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                    }`}
                    data-testid="vacant-plot-btn"
                  >
                    <Home className={`w-5 h-5 ${specialCondition === 'vacant_plot' ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Vacant Plot</span>
                    {specialCondition === 'vacant_plot' && (
                      <CheckCircle className="w-3 h-3 text-blue-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecialCondition(specialCondition === 'wrong_location' ? '' : 'wrong_location')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      specialCondition === 'wrong_location'
                        ? 'border-purple-500 bg-purple-100 text-purple-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300'
                    }`}
                    data-testid="wrong-location-btn"
                  >
                    <MapPin className={`w-5 h-5 ${specialCondition === 'wrong_location' ? 'text-purple-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium text-center">Property ID Wrong Location</span>
                    {specialCondition === 'wrong_location' && (
                      <CheckCircle className="w-3 h-3 text-purple-600" />
                    )}
                  </button>
                </div>
                
                {canSkipRequiredFields && (
                  <div className="p-3 bg-white rounded-lg border border-amber-300">
                    <p className="text-xs text-amber-800 font-medium">
                      ✓ You can submit without receiver details
                    </p>
                  </div>
                )}
                
                {/* Remarks field for special conditions - MANDATORY for all */}
                {canSkipRequiredFields && (
                  <div className="space-y-2 pt-2">
                    <Label className={`font-semibold ${
                      specialCondition === 'owner_denied' ? 'text-red-700' : 
                      specialCondition === 'vacant_plot' ? 'text-blue-700' : 
                      specialCondition === 'wrong_location' ? 'text-purple-700' : 'text-amber-700'
                    }`}>
                      Remarks *
                    </Label>
                    <Textarea
                      value={formData.remarks}
                      onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                      placeholder={
                        specialCondition === 'owner_denied' ? "Required: Please explain why owner denied..." :
                        specialCondition === 'property_locked' ? "Required: Describe the situation (e.g., time, attempts made)..." :
                        specialCondition === 'vacant_plot' ? "Required: Describe the vacant plot condition..." :
                        specialCondition === 'wrong_location' ? "Required: Explain why this property ID is at wrong location..." :
                        "Add remarks..."
                      }
                      rows={2}
                      className={`${
                        specialCondition === 'owner_denied' ? 'border-red-300' : 
                        specialCondition === 'vacant_plot' ? 'border-blue-300' : 
                        specialCondition === 'wrong_location' ? 'border-purple-300' : 'border-amber-300'
                      }`}
                      data-testid="special-remarks-input"
                    />
                    {!formData.remarks?.trim() && (
                      <p className={`text-xs ${
                        specialCondition === 'owner_denied' ? 'text-red-500' : 
                        specialCondition === 'vacant_plot' ? 'text-blue-500' : 
                        specialCondition === 'wrong_location' ? 'text-purple-500' : 'text-amber-500'
                      }`}>
                        Remarks are required for {
                          specialCondition === 'property_locked' ? 'Property Locked' : 
                          specialCondition === 'owner_denied' ? 'Owner Denied' : 
                          specialCondition === 'vacant_plot' ? 'Vacant Plot' : 
                          'Property ID Wrong Location'
                        }
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Property Status - Always show - Same design as Special Conditions */}
            <Card className="border-2 border-slate-200 bg-slate-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-slate-700">
                  <Building className="w-4 h-4" />
                  Property Status *
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-600">
                  Select the construction type of this property:
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setHouseStatus('kachha')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      houseStatus === 'kachha'
                        ? 'border-orange-500 bg-orange-100 text-orange-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300'
                    }`}
                    data-testid="house-status-kachha"
                  >
                    <Home className={`w-5 h-5 ${houseStatus === 'kachha' ? 'text-orange-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Kachha</span>
                    {houseStatus === 'kachha' && (
                      <CheckCircle className="w-3 h-3 text-orange-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHouseStatus('pakka')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      houseStatus === 'pakka'
                        ? 'border-green-500 bg-green-100 text-green-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-green-300'
                    }`}
                    data-testid="house-status-pakka"
                  >
                    <Building className={`w-5 h-5 ${houseStatus === 'pakka' ? 'text-green-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Pakka</span>
                    {houseStatus === 'pakka' && (
                      <CheckCircle className="w-3 h-3 text-green-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHouseStatus('vacant_plot')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      houseStatus === 'vacant_plot'
                        ? 'border-blue-500 bg-blue-100 text-blue-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                    }`}
                    data-testid="house-status-vacant"
                  >
                    <MapPin className={`w-5 h-5 ${houseStatus === 'vacant_plot' ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Vacant Plot</span>
                    {houseStatus === 'vacant_plot' && (
                      <CheckCircle className="w-3 h-3 text-blue-600" />
                    )}
                  </button>
                </div>
                {houseStatus && (
                  <div className={`p-2 rounded-lg text-xs font-medium ${
                    houseStatus === 'kachha' ? 'bg-orange-100 text-orange-700' :
                    houseStatus === 'pakka' ? 'bg-green-100 text-green-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    ✓ Selected: {houseStatus === 'kachha' ? 'Kachha' : houseStatus === 'pakka' ? 'Pakka' : 'Vacant Plot'}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Property Current Use - New Field */}
            <Card className="border-2 border-indigo-200 bg-indigo-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-indigo-700">
                  <Home className="w-4 h-4" />
                  Property Current Use *
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-indigo-600">
                  Select the current usage type of this property:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPropertyUse('residential'); setPropertyUseRemarks(''); }}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      propertyUse === 'residential'
                        ? 'border-indigo-500 bg-indigo-100 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                    }`}
                    data-testid="property-use-residential"
                  >
                    <Home className={`w-5 h-5 ${propertyUse === 'residential' ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Residential</span>
                    {propertyUse === 'residential' && (
                      <CheckCircle className="w-3 h-3 text-indigo-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPropertyUse('commercial'); setPropertyUseRemarks(''); }}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      propertyUse === 'commercial'
                        ? 'border-purple-500 bg-purple-100 text-purple-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300'
                    }`}
                    data-testid="property-use-commercial"
                  >
                    <Building className={`w-5 h-5 ${propertyUse === 'commercial' ? 'text-purple-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Commercial</span>
                    {propertyUse === 'commercial' && (
                      <CheckCircle className="w-3 h-3 text-purple-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPropertyUse('mix_use'); setPropertyUseRemarks(''); }}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      propertyUse === 'mix_use'
                        ? 'border-teal-500 bg-teal-100 text-teal-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'
                    }`}
                    data-testid="property-use-mix"
                  >
                    <Building className={`w-5 h-5 ${propertyUse === 'mix_use' ? 'text-teal-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Mix Use</span>
                    {propertyUse === 'mix_use' && (
                      <CheckCircle className="w-3 h-3 text-teal-600" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPropertyUse('other')}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                      propertyUse === 'other'
                        ? 'border-gray-500 bg-gray-100 text-gray-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-gray-300'
                    }`}
                    data-testid="property-use-other"
                  >
                    <AlertTriangle className={`w-5 h-5 ${propertyUse === 'other' ? 'text-gray-600' : 'text-slate-400'}`} />
                    <span className="text-xs font-medium">Other</span>
                    {propertyUse === 'other' && (
                      <CheckCircle className="w-3 h-3 text-gray-600" />
                    )}
                  </button>
                </div>
                
                {/* Other - Remarks input */}
                {propertyUse === 'other' && (
                  <div className="space-y-2 pt-2">
                    <Label className="text-gray-700 font-semibold">Other Use Remarks *</Label>
                    <Textarea
                      value={propertyUseRemarks}
                      onChange={(e) => setPropertyUseRemarks(e.target.value)}
                      placeholder="Please specify the property use type..."
                      rows={2}
                      className="border-gray-300"
                      data-testid="property-use-remarks"
                    />
                    {!propertyUseRemarks.trim() && (
                      <p className="text-xs text-gray-500">Remarks are required when selecting Other</p>
                    )}
                  </div>
                )}
                
                {propertyUse && propertyUse !== 'other' && (
                  <div className={`p-2 rounded-lg text-xs font-medium ${
                    propertyUse === 'residential' ? 'bg-indigo-100 text-indigo-700' :
                    propertyUse === 'commercial' ? 'bg-purple-100 text-purple-700' :
                    'bg-teal-100 text-teal-700'
                  }`}>
                    ✓ Selected: {propertyUse === 'residential' ? 'Residential' : propertyUse === 'commercial' ? 'Commercial' : 'Mix Use'}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notice Receiver Details - Only show if no special condition */}
            {!canSkipRequiredFields && (
              <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Notice Receiver Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Receiver Name *</Label>
                  <Input
                    value={formData.receiver_name}
                    onChange={(e) => setFormData({ ...formData, receiver_name: e.target.value })}
                    placeholder="Name of person receiving notice"
                    data-testid="receiver-name-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Receiver Mobile Number *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      value={formData.receiver_mobile}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setFormData({ ...formData, receiver_mobile: value });
                      }}
                      placeholder="10-digit mobile number"
                      className="pl-10"
                      maxLength={10}
                      data-testid="receiver-mobile-input"
                    />
                  </div>
                  {formData.receiver_mobile && !validateMobile(formData.receiver_mobile) && (
                    <p className="text-xs text-red-500">Please enter a valid 10-digit mobile number</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Relation with Owner *</Label>
                  <Select
                    value={formData.relation}
                    onValueChange={(value) => setFormData({ ...formData, relation: value })}
                  >
                    <SelectTrigger data-testid="relation-select">
                      <SelectValue placeholder="Select relation" />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Self Certification Section - Conditional based on property.self_certified */}
                {property?.self_certified === true ? (
                  /* SELF-CERTIFIED PROPERTIES: Already done - show success */
                  <div className="p-3 bg-green-100 border-2 border-green-400 rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="font-semibold text-green-800">Property Already Self-Certified ✓</p>
                        <p className="text-xs text-green-700">This property is pre-verified. No additional self-certification required.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* NON-SELF-CERTIFIED PROPERTIES: Show radio options */
                  <Card className="border-2 border-orange-300 bg-orange-50">
                    <CardContent className="py-3 space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-orange-800">Self Certification *</p>
                        </div>
                      </div>
                      
                      {/* ULB Portal Link - FIRST/TOP */}
                      <a 
                        href="https://property.ulbharyana.gov.in/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors"
                        data-testid="ulb-portal-link"
                      >
                        <ExternalLink className="w-5 h-5" />
                        Open ULB Haryana Portal
                      </a>
                      
                      {/* Radio Button Options - No OTP fields */}
                      <div className="space-y-2 pt-2">
                        {/* Option 1: Self Certified - Done */}
                        <label 
                          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            selfCertStatus === 'done' 
                              ? 'border-green-500 bg-green-50' 
                              : 'border-gray-200 bg-white hover:border-green-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="selfCertStatus"
                            value="done"
                            checked={selfCertStatus === 'done'}
                            onChange={(e) => setSelfCertStatus(e.target.value)}
                            className="w-5 h-5 text-green-600"
                            data-testid="self-cert-done"
                          />
                          <div className="flex-1">
                            <span className="font-semibold text-green-700">Self Certified - Done</span>
                          </div>
                          <CheckCircle className={`w-5 h-5 ${selfCertStatus === 'done' ? 'text-green-600' : 'text-gray-300'}`} />
                        </label>
                        
                        {/* Option 2: Owner do later */}
                        <label 
                          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            selfCertStatus === 'later' 
                              ? 'border-yellow-500 bg-yellow-50' 
                              : 'border-gray-200 bg-white hover:border-yellow-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="selfCertStatus"
                            value="later"
                            checked={selfCertStatus === 'later'}
                            onChange={(e) => setSelfCertStatus(e.target.value)}
                            className="w-5 h-5 text-yellow-600"
                            data-testid="self-cert-later"
                          />
                          <div className="flex-1">
                            <span className="font-semibold text-yellow-700">Owner Do Later</span>
                          </div>
                          <AlertTriangle className={`w-5 h-5 ${selfCertStatus === 'later' ? 'text-yellow-600' : 'text-gray-300'}`} />
                        </label>
                        
                        {/* Option 3: Deny */}
                        <label 
                          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            selfCertStatus === 'deny' 
                              ? 'border-red-500 bg-red-50' 
                              : 'border-gray-200 bg-white hover:border-red-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="selfCertStatus"
                            value="deny"
                            checked={selfCertStatus === 'deny'}
                            onChange={(e) => setSelfCertStatus(e.target.value)}
                            className="w-5 h-5 text-red-600"
                            data-testid="self-cert-deny"
                          />
                          <div className="flex-1">
                            <span className="font-semibold text-red-700">Deny</span>
                          </div>
                          <XCircle className={`w-5 h-5 ${selfCertStatus === 'deny' ? 'text-red-600' : 'text-gray-300'}`} />
                        </label>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2">
                  <Label>Remarks</Label>
                  <Textarea
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    placeholder="Any additional comments..."
                    rows={2}
                    data-testid="remarks-input"
                  />
                </div>
              </CardContent>
            </Card>
            )}

            {/* Property Photo */}
            <Card className={canSkipRequiredFields ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  <span className="text-emerald-700">Property Photo</span> {!canSkipRequiredFields && '*'}
                  {canSkipRequiredFields && <span className="text-xs text-amber-600 font-normal">(Optional)</span>}
                </CardTitle>
                <p className="text-xs text-slate-500">Take current photo of the property</p>
              </CardHeader>
              <CardContent>
                <input
                  ref={houseCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handlePhotoCapture(e, 'house')}
                />

                {housePhotoPreview ? (
                  <div className="relative">
                    <img
                      src={housePhotoPreview}
                      alt="Property"
                      className="w-full h-48 object-cover rounded-lg"
                    />
                    {housePhoto && (
                      <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        📷 {(housePhoto.size / 1024).toFixed(0)} KB
                      </div>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        setHousePhoto(null);
                        setHousePhotoPreview(null);
                        try { sessionStorage.removeItem(SURVEY_PHOTO_KEY(propertyId, 'house')); } catch(e) { /* ignore */ }
                      }}
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Retake
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-24"
                    onClick={(e) => { e.preventDefault(); houseCameraRef.current?.click(); }}
                    disabled={processingPhoto === 'house'}
                    data-testid="take-property-photo-btn"
                  >
                    {processingPhoto === 'house' ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Camera className="w-5 h-5 mr-2" />
                        Take Property Photo
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Receiver Photo */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="w-4 h-4" />
                  <span className="text-blue-700">Receiver Photo</span>
                  <span className="text-xs text-slate-500 font-normal">(Optional)</span>
                </CardTitle>
                <p className="text-xs text-slate-500">Take photo of the person receiving the notice</p>
              </CardHeader>
              <CardContent>
                <input
                  ref={receiverCameraRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={(e) => handlePhotoCapture(e, 'receiver')}
                  data-testid="receiver-camera-input"
                />

                {receiverPhotoPreview ? (
                  <div className="relative">
                    <img
                      src={receiverPhotoPreview}
                      alt="Receiver"
                      className="w-full h-48 object-cover rounded-lg"
                    />
                    {receiverPhoto && (
                      <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        📷 {(receiverPhoto.size / 1024).toFixed(0)} KB
                      </div>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        setReceiverPhoto(null);
                        setReceiverPhotoPreview(null);
                        try { sessionStorage.removeItem(SURVEY_PHOTO_KEY(propertyId, 'receiver')); } catch(e) { /* ignore */ }
                      }}
                      data-testid="receiver-retake-btn"
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Retake
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-24"
                    onClick={(e) => { e.preventDefault(); receiverCameraRef.current?.click(); }}
                    disabled={processingPhoto === 'receiver'}
                    data-testid="take-receiver-photo-btn"
                  >
                    {processingPhoto === 'receiver' ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Camera className="w-5 h-5 mr-2" />
                        Take Receiver Photo
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Completed Submission View */}
        {isCompleted && submission && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2 text-emerald-600">
                <CheckCircle className="w-4 h-4" />
                Survey Completed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {submission.special_condition && (
                <div className={`p-3 rounded-lg ${
                  submission.special_condition === 'house_locked' ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                }`}>
                  <p className={`text-sm font-medium flex items-center gap-2 ${
                    submission.special_condition === 'house_locked' ? 'text-amber-700' : 'text-red-700'
                  }`}>
                    {submission.special_condition === 'house_locked' ? (
                      <><Lock className="w-4 h-4" /> House was Locked</>
                    ) : (
                      <><XCircle className="w-4 h-4" /> Owner Denied</>
                    )}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-slate-500 text-xs">Receiver</p>
                  <p className="font-medium">{submission.receiver_name || '-'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs">Receiver Mobile</p>
                  <p className="font-mono">{submission.receiver_mobile || '-'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs">Relation</p>
                  <p className="font-medium">{submission.relation || '-'}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs">Satisfied</p>
                  <p className="font-medium">{submission.self_satisfied === 'yes' ? 'Yes' : submission.self_satisfied === 'no' ? 'No' : '-'}</p>
                </div>
              </div>
              {submission.correct_colony_name && (
                <div>
                  <p className="text-slate-500 text-xs">Corrected Colony</p>
                  <p className="font-medium">{submission.correct_colony_name}</p>
                </div>
              )}
              <div>
                <p className="text-slate-500 text-xs">Submitted At</p>
                <p className="font-medium">{new Date(submission.submitted_at).toLocaleString('en-IN')}</p>
              </div>
            </CardContent>
          </Card>
        )}
          </>
        )}
      </main>

      {/* Submit Button */}
      {!isCompleted && attendanceMarked && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg">
          {submitting && uploadProgress > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div 
                className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12"
            onClick={handleSubmit}
            disabled={submitting || (radiusRequired && withinRange === false)}
            data-testid="submit-survey-btn"
          >
            {submitting ? (
              <div className="flex items-center gap-2 w-full justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Uploading... {uploadProgress}%</span>
              </div>
            ) : (
              <>
                <Send className="w-5 h-5 mr-2" />
                Submit Survey
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
