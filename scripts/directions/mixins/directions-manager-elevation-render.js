import {
  ELEVATION_MARKER_LABEL_VERTICAL_GAP_PX,
  ELEVATION_MARKER_LABEL_HORIZONTAL_PADDING_PX,
  ELEVATION_MARKER_LABEL_TOP_PADDING_PX
} from '../constants/directions-constants.js';

import {
  showElevationChartPhotoPopup
} from '../../map/wikimedia-photos.js';


export class DirectionsManagerElevationRenderMixin {

  // Attach click handlers to photo markers in the elevation chart
  // Opens the photo popup with carousel when clicked
  attachPhotoMarkerClickHandlers() {
    if (!this.elevationChartContainer) return;

    const photoMarkers = this.elevationChartContainer.querySelectorAll('.elevation-marker.photo');

    photoMarkers.forEach(marker => {
      // Make photo markers clickable
      marker.style.pointerEvents = 'auto';
      marker.style.cursor = 'pointer';

      marker.addEventListener('click', (e) => {
        e.stopPropagation();

        const distanceKm = parseFloat(marker.dataset.distanceKm);
        const clusterCount = parseInt(marker.dataset.clusterCount) || 1;

        // Find the photo data from routePhotos
        if (!Array.isArray(this.routePhotos)) return;

        // Find all photos that were clustered at this distance
        // We need to look up the cluster from the allClusterPhotos data
        // For now, find photos near this distance
        const CLUSTER_PROXIMITY = this.routeProfile?.totalDistanceKm / 15 || 1;
        const clusterPhotos = this.routePhotos.filter(photo =>
          Math.abs(photo.distanceKm - distanceKm) < CLUSTER_PROXIMITY
        );

        if (clusterPhotos.length === 0) return;

        // Sort by distance to get the main photo first
        clusterPhotos.sort((a, b) => Math.abs(a.distanceKm - distanceKm) - Math.abs(b.distanceKm - distanceKm));

        const mainPhoto = clusterPhotos[0];

        // Show the popup with carousel
        if (this.map && typeof showElevationChartPhotoPopup === 'function') {
          showElevationChartPhotoPopup(this.map, mainPhoto, clusterPhotos);
        }
      });
    });
  }

  updateElevationMarkerPositions() {
    if (!this.elevationChartContainer) {
      return;
    }
    const markers = Array.from(
      this.elevationChartContainer.querySelectorAll('.elevation-marker[data-distance-km]')
    );
    if (!markers.length) {
      return;
    }

    markers.forEach((marker) => {
      marker.style.removeProperty('--elevation-marker-label-shift');
    });

    let domainMin = Number(this.elevationDomain?.min);
    let domainMax = Number(this.elevationDomain?.max);
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      const totalDistance = Number(this.routeProfile?.totalDistanceKm);
      if (Number.isFinite(totalDistance) && totalDistance > 0) {
        domainMin = 0;
        domainMax = totalDistance;
      }
    }
    if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
      return;
    }
    const domainLow = Math.min(domainMin, domainMax);
    const domainHigh = Math.max(domainMin, domainMax);
    const span = domainHigh - domainLow;
    if (!(span > 0)) {
      return;
    }

    const yMin = Number(this.elevationYAxis?.min);
    const yMax = Number(this.elevationYAxis?.max);
    const ySpan = yMax - yMin;
    const canPositionVertically = Number.isFinite(yMin)
      && Number.isFinite(yMax)
      && Math.abs(ySpan) > Number.EPSILON;

    const containerWidth = Number(this.elevationChartContainer?.clientWidth) || 0;
    const markerEntries = markers
      .map((marker) => {
        const distanceKm = Number(marker.dataset.distanceKm);
        if (!Number.isFinite(distanceKm)) {
          return null;
        }
        const isPoiMarker = marker.classList.contains('poi');
        const isBivouacMarker = marker.classList.contains('bivouac');
        const isPhotoMarker = marker.classList.contains('photo');
        const ratio = span > 0 ? (distanceKm - domainLow) / span : 0;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        const percent = clampedRatio * 100;
        return {
          marker,
          isPoiMarker,
          isBivouacMarker,
          isPhotoMarker,
          clampedRatio,
          percent,
          hasLabel: Boolean(marker.querySelector('.elevation-marker__label'))
        };
      })
      .filter(Boolean);

    const clusterShiftMap = new Map();
    if (containerWidth > 0) {
      const labelledEntries = markerEntries
        .filter((entry) => entry.hasLabel && (entry.isPoiMarker || entry.isBivouacMarker))
        .sort((a, b) => a.percent - b.percent);

      const placedLabels = [];
      labelledEntries.forEach((entry) => {
        const labelElement = entry.marker.querySelector('.elevation-marker__label');
        if (!labelElement) {
          return;
        }

        const labelRect = typeof labelElement.getBoundingClientRect === 'function'
          ? labelElement.getBoundingClientRect()
          : null;
        const labelWidth = Number(labelElement.offsetWidth)
          || Number(labelRect?.width)
          || 0;
        const labelHeight = Number(labelElement.offsetHeight)
          || Number(labelRect?.height)
          || 0;

        if (labelWidth <= 0 || labelHeight <= 0) {
          clusterShiftMap.set(entry.marker, 0);
          return;
        }

        const centerPx = (entry.percent / 100) * containerWidth;
        const halfWidth = labelWidth / 2;
        const horizontalPadding = ELEVATION_MARKER_LABEL_HORIZONTAL_PADDING_PX;
        const left = centerPx - halfWidth - horizontalPadding;
        const right = centerPx + halfWidth + horizontalPadding;

        let requiredShift = 0;
        for (const placed of placedLabels) {
          if (right <= placed.left || left >= placed.right) {
            continue;
          }
          const candidateShift = placed.shift + placed.height + ELEVATION_MARKER_LABEL_VERTICAL_GAP_PX;
          if (candidateShift > requiredShift) {
            requiredShift = candidateShift;
          }
        }

        clusterShiftMap.set(entry.marker, requiredShift);
        placedLabels.push({ left, right, shift: requiredShift, height: labelHeight });
      });
    }

    const containerRect = typeof this.elevationChartContainer.getBoundingClientRect === 'function'
      ? this.elevationChartContainer.getBoundingClientRect()
      : null;

    markerEntries.forEach((entry) => {
      const { marker, isPoiMarker, isBivouacMarker, isPhotoMarker, clampedRatio, percent, hasLabel } = entry;

      // Hide markers outside the current visible domain range
      const distanceKm = Number(marker.dataset.distanceKm);
      if (Number.isFinite(distanceKm) && (distanceKm < domainLow || distanceKm > domainHigh)) {
        marker.style.display = 'none';
        return;
      }

      // Handle photo visibility toggle
      if (isPhotoMarker && !this.showElevationPhotos) {
        marker.style.display = 'none';
        return;
      }

      marker.style.display = '';

      const labelElement = hasLabel ? marker.querySelector('.elevation-marker__label') : null;
      marker.style.left = `${percent.toFixed(6)}%`;

      const offsetValue = Number(marker.dataset.bottomOffset);
      const offsetPx = Number.isFinite(offsetValue) ? offsetValue : 0;

      if ((isPoiMarker || isBivouacMarker || isPhotoMarker) && canPositionVertically) {
        const clampedDistanceKm = domainLow + clampedRatio * span;
        const elevation = this.getElevationAtDistance(clampedDistanceKm);

        if (Number.isFinite(elevation)) {
          const normalized = (elevation - yMin) / ySpan;
          const clampedElevation = Math.max(0, Math.min(1, normalized));
          const elevationPercent = clampedElevation * 100;

          // Check for internal stacking metadata
          const stackType = marker.dataset.stackType;

          if (stackType === 'internal') {
            const stackIndex = Number(marker.dataset.stackIndex);
            const stackTotal = Number(marker.dataset.stackTotal);

            if (Number.isFinite(stackIndex) && Number.isFinite(stackTotal)) {
              const ratio = (stackTotal - stackIndex - 0.5) / stackTotal;
              const distributedPercent = elevationPercent * ratio;
              marker.style.bottom = `max(15px, ${distributedPercent.toFixed(6)}%)`;
            } else {
              marker.style.bottom = `max(15px, ${elevationPercent.toFixed(6)}%)`;
            }
          } else if (isPhotoMarker) {
            // Photos should never go below the X axis
            // Max height is 60px + margin, so we need a bit of clearance
            const PHOTO_MIN_BOTTOM = '40px';
            if (offsetPx !== 0) {
              marker.style.bottom = `max(${PHOTO_MIN_BOTTOM}, calc(${elevationPercent.toFixed(6)}% + ${offsetPx}px))`;
            } else {
              marker.style.bottom = `max(${PHOTO_MIN_BOTTOM}, ${elevationPercent.toFixed(6)}%)`;
            }
          } else {
            const offsetSuffix = offsetPx !== 0 ? ` + ${offsetPx}px` : '';
            if (offsetSuffix) {
              marker.style.bottom = `max(15px, calc(${elevationPercent.toFixed(6)}%${offsetSuffix}))`;
            } else {
              marker.style.bottom = `max(15px, ${elevationPercent.toFixed(6)}%)`;
            }
          }

          if (isBivouacMarker) {
            const containerHeight = this.elevationChartContainer?.clientHeight || 0;
            const lineHeightPx = Math.max(0, clampedElevation * containerHeight);
            marker.style.setProperty('--bivouac-line-height', `${lineHeightPx.toFixed(1)}px`);
          }
        } else {
          // Fallback if elevation is not finite
          marker.style.bottom = `${offsetPx}px`;
          if (isBivouacMarker) {
            marker.style.setProperty('--bivouac-line-height', '0px');
          }
        }
      } else if (isPoiMarker || isBivouacMarker || isPhotoMarker) {
        // Fallback if cannot position vertically
        marker.style.bottom = `${offsetPx}px`;
        if (isBivouacMarker) {
          marker.style.setProperty('--bivouac-line-height', '0px');
        }
      }

      const clusterShift = clusterShiftMap.get(marker);
      if (Number.isFinite(clusterShift) && clusterShift > 0 && labelElement) {
        let appliedShift = clusterShift;
        if (containerRect && typeof labelElement.getBoundingClientRect === 'function') {
          const labelRect = labelElement.getBoundingClientRect();
          const containerTop = Number(containerRect?.top);
          const labelTop = Number(labelRect?.top);
          if (Number.isFinite(containerTop) && Number.isFinite(labelTop)) {
            const availableShift = labelTop - containerTop - ELEVATION_MARKER_LABEL_TOP_PADDING_PX;
            if (Number.isFinite(availableShift)) {
              appliedShift = Math.min(appliedShift, Math.max(0, availableShift));
            }
          }
        }

        if (appliedShift > 0.5) {
          marker.style.setProperty('--elevation-marker-label-shift', `${appliedShift.toFixed(2)}px`);
        }
      }
    });

    // Collision detection for photo markers
    if (this.showElevationPhotos && containerWidth > 0 && containerRect) {
      const photoEntries = markerEntries.filter(e => e.isPhotoMarker && e.marker.style.display !== 'none');

      // Reset any previous scaling
      photoEntries.forEach(e => {
        e.marker.style.transform = '';
        e.marker.style.zIndex = '';
      });

      // Sort by X position
      photoEntries.sort((a, b) => a.percent - b.percent);

      const PHOTO_SIZE_PX = 32; // Match the rendering size
      const MIN_SIZE_PX = 24;   // Minimum size when overlapping

      const getEstimatedRect = (entry) => {
        const x = (entry.percent / 100) * containerWidth;
        return { x, width: PHOTO_SIZE_PX };
      };

      for (let i = 0; i < photoEntries.length; i++) {
        const current = photoEntries[i];
        const currentRect = getEstimatedRect(current);
        let overlapFactor = 0;

        // Check neighbors
        for (let j = i + 1; j < photoEntries.length; j++) {
          const next = photoEntries[j];
          const nextRect = getEstimatedRect(next);

          // If X distance is less than width, they *might* overlap
          const dist = nextRect.x - currentRect.x;
          if (dist < PHOTO_SIZE_PX) {
            // They are close horizontally.
            overlapFactor = Math.max(overlapFactor, 1 - (dist / PHOTO_SIZE_PX));

            // Also mark the neighbor as overlapping
            next.overlap = Math.max(next.overlap || 0, 1 - (dist / PHOTO_SIZE_PX));
          } else {
            // Sorted by X, so no need to check further
            break;
          }
        }
        current.overlap = Math.max(current.overlap || 0, overlapFactor);
      }

      // Apply scaling based on overlap
      photoEntries.forEach(entry => {
        if (entry.overlap > 0.2) { // Tolerance
          const targetSize = Math.max(MIN_SIZE_PX, PHOTO_SIZE_PX - (entry.overlap * (PHOTO_SIZE_PX - MIN_SIZE_PX)));
          const scale = targetSize / PHOTO_SIZE_PX;
          entry.marker.style.transform = `translate(-50%, 50%) scale(${scale})`;
          entry.marker.style.zIndex = '15'; // Lower z-index for shrunk items
        } else {
          entry.marker.style.zIndex = '20'; // Normal z-index
        }
      });
    }
  }


  updateElevationHoverReadout(distanceKm) {
    if (!Number.isFinite(distanceKm)) {
      if (this.elevationHoverIndicator) {
        this.elevationHoverIndicator.setAttribute('aria-hidden', 'true');
      }
      this.updateRouteStatsHover(null);
      return;
    }

    this.updateRouteStatsHover(distanceKm);
  }


  renderElevationSparkline() {
    const sparklineBg = this.routeStats?.querySelector('.route-stats__sparkline');
    const target = sparklineBg || this.elevationCollapseToggle;
    if (!target) return;

    // First, try to use elevationSamples if they are already processed
    // Fallback to generating them from the routeProfile if available
    let samples = Array.isArray(this.elevationSamples) && this.elevationSamples.length > 0
      ? this.elevationSamples
      : null;

    if (!samples && this.routeProfile) {
      const coordinates = this.routeProfile.coordinates || [];
      samples = this.generateElevationSamples(coordinates);
    }

    if (!Array.isArray(samples) || samples.length < 2) {
      this.elevationCollapseToggle.classList.add('elevation-toggle--empty');
      this.elevationCollapseToggle.innerHTML = '<span class="sr-only">Afficher le profil d\'élévation</span>';
      return;
    }

    // Filter samples based on selected day if applicable
    if (this.selectedDayIndex !== null && this.selectedDayIndex !== undefined && Array.isArray(this.cutSegments)) {
      const segment = this.cutSegments[this.selectedDayIndex];
      if (segment) {
        const startDist = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
        const endDist = Number(segment.endKm ?? segment.endDistanceKm ?? startDist);
        samples = samples.filter(s => {
          const d = s.distanceKm ?? s.endDistanceKm ?? 0;
          return d >= startDist && d <= endDist;
        });
      }
    }
    this.elevationCollapseToggle.classList.remove('elevation-toggle--empty');

    // Downsample for a "coarse" look as requested by user (approx 30 points)
    const MAX_POINTS = 30;
    let displaySamples = samples;
    if (samples.length > MAX_POINTS) {
      const factor = Math.max(1, Math.floor(samples.length / MAX_POINTS));
      displaySamples = samples.filter((_, i) => i % factor === 0);
      if (displaySamples[displaySamples.length - 1] !== samples[samples.length - 1]) {
        displaySamples.push(samples[samples.length - 1]);
      }
    }

    const elevations = displaySamples.map(s => s.elevation);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const range = Math.max(1, max - min);

    const distances = displaySamples.map(s => s.distanceKm ?? s.endDistanceKm ?? 0);
    const distMin = distances[0];
    const distMax = distances[distances.length - 1];
    const distRange = Math.max(0.001, distMax - distMin);

    // Vertical padding to ensure peaks/valleys aren't cut off (15% padding)
    const PADDING_Y = 15;
    const SCALE_Y = 100 - (PADDING_Y * 2);

    // Determine segments to draw
    const isSingleDayView = this.selectedDayIndex !== null && this.selectedDayIndex !== undefined;
    const drawingSegments = [];

    if (isSingleDayView && Array.isArray(this.cutSegments)) {
      const seg = this.cutSegments[this.selectedDayIndex];
      if (seg) drawingSegments.push(seg);
    } else if (Array.isArray(this.cutSegments) && this.cutSegments.length > 0) {
      drawingSegments.push(...this.cutSegments);
    } else {
      drawingSegments.push({ color: '#f8b40b', startKm: distMin, endKm: distMax });
    }

    let defsContent = '';
    let pathsContent = '';

    drawingSegments.forEach((segment, idx) => {
      const startDist = Number(segment.startKm ?? segment.startDistanceKm ?? 0);
      const endDist = Number(segment.endKm ?? segment.endDistanceKm ?? startDist);
      const color = segment.color || '#f8b40b';

      // Filter display samples for this segment
      // Use a small epsilon to catch points exactly on the boundary
      const EPSILON = 1e-6;
      let segmentSamples = displaySamples.filter(s => {
        const d = s.distanceKm ?? s.endDistanceKm ?? 0;
        return d >= (startDist - EPSILON) && d <= (endDist + EPSILON);
      });

      // Ensure segment starts exactly at startDist to avoid gaps
      if (!segmentSamples.length || Math.abs((segmentSamples[0].distanceKm ?? 0) - startDist) > EPSILON) {
        const startElev = this.getElevationAtDistance(startDist);
        if (Number.isFinite(startElev)) {
          segmentSamples.unshift({ distanceKm: startDist, elevation: startElev });
        }
      }
      // Ensure segment ends exactly at endDist to avoid gaps
      if (segmentSamples.length > 0 && Math.abs((segmentSamples[segmentSamples.length - 1].distanceKm ?? 0) - endDist) > EPSILON) {
        const endElev = this.getElevationAtDistance(endDist);
        if (Number.isFinite(endElev)) {
          segmentSamples.push({ distanceKm: endDist, elevation: endElev });
        }
      }

      if (segmentSamples.length < 2) return;

      const points = segmentSamples.map((sample) => {
        const dist = sample.distanceKm ?? sample.endDistanceKm ?? 0;
        const elev = sample.elevation ?? min;
        const x = ((dist - distMin) / distRange) * 100;
        const y = (100 - PADDING_Y) - ((elev - min) / range) * SCALE_Y;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

      const d = `M ${points.join(' L ')}`;
      const startX = ((segmentSamples[0].distanceKm ?? segmentSamples[0].endDistanceKm ?? 0) - distMin) / distRange * 100;
      const endX = ((segmentSamples[segmentSamples.length - 1].distanceKm ?? segmentSamples[segmentSamples.length - 1].endDistanceKm ?? 0) - distMin) / distRange * 100;
      const fillD = `${d} L ${endX.toFixed(1)},100 L ${startX.toFixed(1)},100 Z`;

      const gradId = `sparkline-grad-${idx}-${Math.floor(Math.random() * 1000)}`;
      defsContent += `
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${color}; stop-opacity:0.7" />
          <stop offset="100%" style="stop-color:${color}; stop-opacity:0.2" />
        </linearGradient>
      `;
      pathsContent += `
        <path d="${fillD}" fill="url(#${gradId})"></path>
        <path d="${d}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
      `;
    });

    // Add Photo Markers to Sparkline
    let photoMarkersContent = '';
    if (this.showElevationPhotos && Array.isArray(this.routePhotos)) {
      this.routePhotos.forEach(photo => {
        const dist = Number(photo.distanceKm);
        if (Number.isFinite(dist) && dist >= distMin && dist <= distMax) {
          const elev = this.getElevationAtDistance(dist) ?? min;
          const x = ((dist - distMin) / distRange) * 100;
          const y = (100 - PADDING_Y) - ((elev - min) / range) * SCALE_Y;

          photoMarkersContent += `
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#ffffff" stroke="#1a73e8" stroke-width="1.5" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          `;
        }
      });
    }

    // Create a highly visible, coarse SVG preview
    target.innerHTML = `
      <svg class="elevation-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="width:100%; height:100%; display:block; pointer-events:none; overflow:visible;">
        <defs>${defsContent}</defs>
        ${pathsContent}
        ${photoMarkersContent}
      </svg>
      <span class="sr-only">Profil d'élévation</span>
    `;
  }

}
