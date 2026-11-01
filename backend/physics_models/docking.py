"""Planar docking report from the shared stateful physics/control plant."""
from .docking_plant import DockingPlant

def docking(config):
    plant=DockingPlant(config)
    plant.rollout()
    return plant.result()
